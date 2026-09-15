/**
 * IFC4Exporter.ts
 *
 * IFC4 export. The scene is classified automatically: every product gets an IFC entity, a
 * PredefinedType and a host (the storey or element it belongs to), from the scene hierarchy and cheap
 * shape features only. The classification becomes a format-neutral building model, which is written as
 * an IFC4 Reference View file.
 *
 * Sections
 *   1. Spec       TUNING and IFC_ENTITIES: the human-facing classification settings. Start here.
 *   2. Types      what the predicates in IFC_ENTITIES receive
 *   3. Measure    measureScene(): the only part that touches geometry, produces a plain FeatureTree
 *   4. Derive     shape, children and host-relative features from the FeatureTree
 *   5. Resolve    classifyTree() / classifyScene(): the decision procedure
 *   6. Views      explainIfc(), ifcHistogram()
 *   7. Model      buildModel(): parents, bodies, materials, quantities, properties
 *   8. SPF        SPFWriter: ISO 10303-21 values and file
 *   9. GUID       ifcGuid(): deterministic 22-character GlobalIds from scene paths
 *  10. IFC4       serializeIFC4(), buildIFC()
 *
 * How a node is decided (section 5), identical for every entity:
 *
 *   - An explicit tag (`node._is` / `shape.metadata.is`, set by `.is('ifc:…')`) always wins.
 *   - Only entities whose `hosts` include the current host are candidates. The hosts ARE the IFC
 *     hierarchy: a vertical stick is an IfcMember inside an IfcWall and an IfcColumn on a storey.
 *   - A CONTAINER (a layer or component) trusts its composition: the first entity whose `children`
 *     predicate passes wins, and a name that points elsewhere is reported as a conflict. This is
 *     what turns a roof component that a script named 'wallBack' into an IfcRoof.
 *   - A LEAF (one shape) trusts its name: the first name token (read right to left) that belongs to
 *     an allowed entity wins, and a different geometric verdict is kept as `alternative`. Names
 *     come from make.wall() and from variable auto-naming, and are right far more often than ratios.
 *     Without a usable name, the first entity whose `shape` predicate passes wins.
 *   - Nothing matched: a container with solids becomes IfcElementAssembly (or dissolves when its
 *     shapes stand on their own), a solid becomes IfcBuildingElementProxy. Both are reported.
 *   - Inside an element (wall, slab, roof, ...) sub-layers dissolve: every shape below it is a
 *     part of that element. So the wrapper layer make.wall() creates never becomes a product.
 */

import type { ModelUnits } from './types'
import { MM_PER_UNIT } from '../units/UnitConverter'
import { isBrepShape, brepShapeToMeshup, DEFAULT_MESHING_QUALITY } from './brep/toMeshup'
import { recipeOf, resolveRecipe, asCuboid, type Classification } from './Recipe'

//// 1. SPEC ////

/** Every threshold of the classifier. Lengths are millimetres and are scaled to the model units.
 *  Each comment names the shape in the corpus (tests/fixtures/house) that pinned the value. */
export const TUNING = {
    /** length / width at or above this: a stick. A roof block 214 x 2638 is 12, a 200 x 200 offcut is 1 */
    STICK_MIN_LENGTH_RATIO: 2.5,
    /** width / thickness at or below this: a stick section. Stud 38 x 200 is 5.3 */
    STICK_MAX_SECTION_ASPECT: 6,
    /** width / thickness at or above this: a board. Make.partList's PLATE_RATIO */
    BOARD_MIN_ASPECT: 10,
    /** volume / oriented box volume at or above this: a box. Gable-cut studs are about 0.97 */
    BOX_FILL: 0.9,
    /** volume / oriented box volume below this: a hollow frame (window and door frames) */
    HOLLOW_FILL: 0.5,
    /** Long axis within this many degrees of Z: vertical. Studs */
    VERTICAL_DEG: 15,
    /** Long axis within this many degrees of the ground plane: horizontal. Plates, purlins */
    HORIZONTAL_DEG: 10,
    /** Same direction when axes differ less than this many degrees (dominant sticks, slope sets) */
    SAME_DIRECTION_DEG: 15,
    /** Aggregate thickness / next extent at or below this: a thin container. Wall 200 / 2100 */
    CONTAINER_THIN_RATIO: 0.25,
    /** Share of sticks that is sloped at or above this: a roof. A gable wall has 2 of about 12 */
    SLOPED_DOMINANCE: 0.5,
    /** A standing thin box at least this tall is a wall, not a beam */
    WALL_MIN_HEIGHT_MM: 1200,
    /** Depth in the host / host thickness at or above this, together with BAY_MIN_WIDTH_MM: fills a bay */
    BAY_FILL_THICKNESS: 0.9,
    /** A bay filler is at least this wide in the host plane. A stud is 38 */
    BAY_MIN_WIDTH_MM: 100,
    /** Length / median stick length in the host below this: a short member (blocking, sill, nogging) */
    SHORT_MEMBER_RATIO: 0.5,
    /** Within this distance of the host envelope: touching it */
    ENVELOPE_TOL_MM: 5,
    /** A horizontal stick at most this far above or below an opening frames it (lintel, sill) */
    OPENING_ADJACENT_MM: 100,
    /** Bases of storey-level elements closer than this share one storey */
    STOREY_MIN_SEPARATION_MM: 2000,
    /** Openings reach this far beyond both faces of their host, so the cut is clean in every viewer */
    OPENING_OVERSHOOT_MM: 10,
    /** Cylinders shorter than this: fasteners */
    FASTENER_MAX_LENGTH_MM: 200,
    /** An opening starting at most this far above the base of its wall reaches the floor: a door. Front door 100, left window 500 */
    DOOR_MAX_SILL_MM: 150,
    /** A floor-level opening at least this tall is a door; a lower one gets no filling. Housetest's 1600 front opening is not a door */
    DOOR_MIN_HEIGHT_MM: 1800,
} as const

const T = TUNING

/** Name tokens that say where a part is, not what it is. Dropped before matching names. */
export const NAME_STOPWORDS = new Set([
    'left', 'right', 'front', 'back', 'rear', 'top', 'bottom', 'mid', 'middle', 'center', 'centre',
    'inside', 'outside', 'inner', 'outer', 'upper', 'lower', 'horizontal', 'horizontals', 'vertical', 'verticals',
    'first', 'last', 'start', 'end', 'main', 'extra', 'new', 'copy', 'tmp', 'temp', 'the', 'of', 'and',
    'links', 'rechts', 'voor', 'achter', 'boven', 'onder',
])

/**
 * The classification settings: one entry per IFC entity, in precedence order (earlier entries are
 * tried first). Each entry answers the same questions in the same place:
 *
 *   hosts      where may I live (the IFC aggregation / containment hierarchy)
 *   kinds      which shape kinds can I be ('solid' unless stated)
 *   name       which name tokens mean me, and the PredefinedType[:ObjectType] they imply (null: decide by subclass)
 *   shape      a leaf looks like me
 *   children   a container holds what I hold
 *   opening    I fill an opening of my host that looks like this (doors and windows in make.wall() openings)
 *   subclass   which PredefinedType: the first predicate that passes, else NOTDEFINED
 *   objectType a free ObjectType label on top of the PredefinedType (IFC4 has no SILL or BLOCKING); the
 *              predicate also receives the chosen PredefinedType. Not used when the name already gave one
 *   ifc        property set, quantity set and class URI for the serializers
 */
export const IFC_ENTITIES: Record<IfcEntity, EntityRule> = {

    IfcBuildingStorey: {
        hosts: ['IfcBuilding'],
        name: { storey: null, story: null, level: null, verdieping: null, floor: null, etage: null },
        // holds at least two walls, and nothing that cannot stand on a storey
        children: c => c.childEntities.filter(e => e === 'IfcWall').length >= 2 && c.childEntities.every(e => STOREY_LEVEL.has(e)),
        ifc: { pset: 'Pset_BuildingStoreyCommon', uri: uri('IfcBuildingStorey') },
    },

    IfcFooting: {
        hosts: ['IfcBuildingStorey', 'IfcSite'],
        name: { foundation: null, footing: null, fundering: null, fundament: null, poer: 'PAD_FOOTING', strook: 'STRIP_FOOTING' },
        shape: (s, ctx) => s.base <= ctx.storey.elevation + ctx.mm(T.ENVELOPE_TOL_MM) && (s.material === 'concrete' || s.material === 'stone'),
        children: (c, ctx) => c.aggregate.base <= ctx.storey.elevation + ctx.mm(T.ENVELOPE_TOL_MM) && c.materials.majority === 'concrete',
        subclass: {
            STRIP_FOOTING: n => n.class === 'stick',
            PAD_FOOTING: n => n.class === 'block',
        },
        ifc: { pset: 'Pset_FootingCommon', qto: 'Qto_FootingBaseQuantities', uri: uri('IfcFooting') },
    },

    // Above IfcWall: a roof component that a script misnamed as a wall still resolves here by composition.
    IfcRoof: {
        hosts: ['IfcBuildingStorey'],
        name: { roof: null, dak: null, kap: null },
        children: c => c.sticks.all.length > 0
                    && c.sticks.sloped.length >= T.SLOPED_DOMINANCE * c.sticks.all.length
                    && c.sticks.vertical.length === 0,
        shape: s => s.class === 'board' && s.thinDir === 'sloped',
        subclass: {
            GABLE_ROOF: n => n.isContainer && n.slopeSets === 2,
            SHED_ROOF: n => n.isContainer ? n.slopeSets === 1 : true,
            FLAT_ROOF: n => n.isContainer && n.sticks.sloped.length === 0,
        },
        ifc: { pset: 'Pset_RoofCommon', qto: 'Qto_RoofBaseQuantities', uri: uri('IfcRoof') },
    },

    IfcWall: {
        hosts: ['IfcBuildingStorey', 'IfcElementAssembly'],
        name: { wall: null, walls: null, muur: null, wand: null, gevel: null },
        // framed wall: a thin standing aggregate that holds vertical sticks
        children: (c, ctx) => c.aggregate.isThin && c.aggregate.thinDir === 'horizontal'
                           && c.aggregate.height >= ctx.mm(T.WALL_MIN_HEIGHT_MM)
                           && c.sticks.vertical.length >= 2,
        // monolithic wall: one standing thin box
        shape: (s, ctx) => s.class === 'board' && s.thinDir === 'horizontal' && s.height >= ctx.mm(T.WALL_MIN_HEIGHT_MM),
        subclass: {
            ELEMENTEDWALL: n => n.isContainer,
            POLYGONAL: n => !n.isContainer && !n.isBox,
            SOLIDWALL: () => true,
        },
        ifc: { pset: 'Pset_WallCommon', qto: 'Qto_WallBaseQuantities', uri: uri('IfcWall') },
    },

    IfcSlab: {
        hosts: ['IfcBuildingStorey', 'IfcRoof', 'IfcStair', 'IfcElementAssembly'],
        name: { slab: null, floor: 'FLOOR', vloer: 'FLOOR', deck: null, landing: 'LANDING', bordes: 'LANDING' },
        children: c => c.aggregate.isThin && c.aggregate.thinDir === 'vertical'
                    && (c.sticks.horizontal.length > 0 || c.boards.length > 0),
        shape: (s, ctx) => s.class === 'board' && (s.thinDir === 'vertical'
                        || (ctx.host.entity === 'IfcRoof' && ctx.host.sticks.all.length === 0)),
        subclass: {
            ROOF: (n, ctx) => ctx.host.entity === 'IfcRoof',
            LANDING: (n, ctx) => ctx.host.entity === 'IfcStair',
            BASESLAB: (n, ctx) => n.base <= ctx.storey.elevation + ctx.mm(T.ENVELOPE_TOL_MM) && n.material === 'concrete',
            FLOOR: () => true,
        },
        ifc: { pset: 'Pset_SlabCommon', qto: 'Qto_SlabBaseQuantities', uri: uri('IfcSlab') },
    },

    // Above the members: an insulation bay is a "stick" by its ratios alone.
    IfcBuildingElementPart: {
        hosts: ['IfcWall', 'IfcSlab', 'IfcRoof', 'IfcFooting'],
        name: { insulation: 'INSULATION', isolatie: 'INSULATION', isolation: 'INSULATION', wool: 'INSULATION', wol: 'INSULATION' },
        shape: (s, ctx) => s.material === 'insulation'
                        || (s.depthInHost >= T.BAY_FILL_THICKNESS * ctx.host.aggregate.thickness
                            && s.widthInHost >= ctx.mm(T.BAY_MIN_WIDTH_MM)
                            && !s.touches.has('top') && !s.touches.has('bottom')),
        subclass: {
            INSULATION: () => true,
        },
        ifc: { uri: uri('IfcBuildingElementPart') },
    },

    // Above IfcWindow: an opening that reaches the floor is a door, the rest are windows.
    IfcDoor: {
        hosts: ['IfcWall', 'IfcBuildingStorey'],
        name: { door: 'DOOR', deur: 'DOOR', gate: 'GATE', poort: 'GATE' },
        opening: (o, ctx) => ctx.host.entity === 'IfcWall' && o.sill <= ctx.mm(T.DOOR_MAX_SILL_MM) && o.height >= ctx.mm(T.DOOR_MIN_HEIGHT_MM),
        shape: (s, ctx) => ctx.host.entity === 'IfcWall' && s.fill < T.HOLLOW_FILL && s.touches.has('bottom'),
        subclass: {
            DOOR: () => true,
        },
        ifc: { pset: 'Pset_DoorCommon', qto: 'Qto_DoorBaseQuantities', uri: uri('IfcDoor') },
    },

    IfcWindow: {
        hosts: ['IfcWall', 'IfcRoof', 'IfcBuildingStorey'],
        name: { window: null, raam: null, kozijn: null, skylight: 'SKYLIGHT', dakraam: 'SKYLIGHT' },
        opening: (o, ctx) => ctx.host.entity === 'IfcRoof' || o.sill > ctx.mm(T.DOOR_MAX_SILL_MM),
        shape: (s, ctx) => ELEMENT_HOSTS.has(ctx.host.entity) && s.fill < T.HOLLOW_FILL && !s.touches.has('bottom'),
        children: c => c.materials.has('glass'),
        subclass: {
            SKYLIGHT: (n, ctx) => ctx.host.entity === 'IfcRoof',
            WINDOW: () => true,
        },
        ifc: { pset: 'Pset_WindowCommon', qto: 'Qto_WindowBaseQuantities', uri: uri('IfcWindow') },
    },

    IfcMechanicalFastener: {
        hosts: ['*'],
        name: { screw: 'SCREW', schroef: 'SCREW', bolt: 'BOLT', bout: 'BOLT', nail: 'NAIL', spijker: 'NAIL', dowel: 'DOWEL', deuvel: 'DOWEL' },
        shape: (s, ctx) => s.subtype === 'Cylinder' && s.length < ctx.mm(T.FASTENER_MAX_LENGTH_MM),
        ifc: { uri: uri('IfcMechanicalFastener') },
    },

    // Above IfcPlate: the outermost board of an element, or a finish or membrane.
    IfcCovering: {
        hosts: ['IfcWall', 'IfcSlab', 'IfcRoof'],
        name: {
            cladding: 'CLADDING', siding: 'CLADDING', gevelbekleding: 'CLADDING', bekleding: 'CLADDING',
            flooring: 'FLOORING', vloerafwerking: 'FLOORING', ceiling: 'CEILING', plafond: 'CEILING',
            roofing: 'ROOFING', dakbedekking: 'ROOFING', membrane: 'MEMBRANE', folie: 'MEMBRANE',
        },
        shape: s => s.class === 'board' && s.plane === 'inPlane'
                 && (s.touches.has('face') || s.material === 'finish' || s.material === 'membrane'),
        subclass: {
            MEMBRANE: n => n.material === 'membrane',
            CLADDING: (n, ctx) => ctx.host.entity === 'IfcWall',
            FLOORING: (n, ctx) => ctx.host.entity === 'IfcSlab' && n.touches.has('top'),
            CEILING: (n, ctx) => ctx.host.entity === 'IfcSlab' && n.touches.has('bottom'),
            ROOFING: (n, ctx) => ctx.host.entity === 'IfcRoof',
        },
        ifc: { pset: 'Pset_CoveringCommon', qto: 'Qto_CoveringBaseQuantities', uri: uri('IfcCovering') },
    },

    IfcPlate: {
        hosts: ['IfcWall', 'IfcSlab', 'IfcRoof', 'IfcWindow', 'IfcDoor', 'IfcElementAssembly'],
        name: {
            sheathing: 'SHEET', board: 'SHEET', osb: 'SHEET', plywood: 'SHEET', multiplex: 'SHEET',
            panel: 'SHEET', plaat: 'SHEET', beplating: 'SHEET', glazing: 'SHEET', glass: 'SHEET', glas: 'SHEET',
        },
        shape: s => s.class === 'board' && s.plane === 'inPlane',
        subclass: {
            SHEET: () => true,
        },
        ifc: { pset: 'Pset_PlateCommon', qto: 'Qto_PlateBaseQuantities', uri: uri('IfcPlate') },
    },

    // Above IfcMember: lintels and joists are sticks too.
    IfcBeam: {
        hosts: ['IfcBuildingStorey', 'IfcSlab', 'IfcRoof', 'IfcWall', 'IfcElementAssembly'],
        name: {
            beam: 'BEAM', balk: 'BEAM', ligger: 'BEAM', joist: 'JOIST', lintel: 'LINTEL', latei: 'LINTEL',
            header: 'BEAM:HEADER', support: 'BEAM:BEARER', bearer: 'BEAM:BEARER', onderslag: 'BEAM:BEARER',
        },
        shape: (s, ctx) => s.class === 'stick' && s.longDir === 'horizontal' && (
            ctx.host.entity === 'IfcWall' ? s.spansOpening === 'above'
          : ctx.host.entity === 'IfcRoof' ? ctx.host.sticks.sloped.length === 0
          : true),
        subclass: {
            LINTEL: (n, ctx) => ctx.host.entity === 'IfcWall',
            JOIST: (n, ctx) => (ctx.host.entity === 'IfcSlab' || ctx.host.entity === 'IfcRoof') && n.alongDominant,
            BEAM: () => true,
        },
        ifc: { pset: 'Pset_BeamCommon', qto: 'Qto_BeamBaseQuantities', uri: uri('IfcBeam') },
    },

    // Above IfcMember: on a storey a vertical stick is a column (columns may not live in a wall or roof).
    IfcColumn: {
        hosts: ['IfcBuildingStorey', 'IfcElementAssembly'],
        name: { column: 'COLUMN', kolom: 'COLUMN', pillar: 'COLUMN', pilaar: 'COLUMN' },
        shape: s => s.class === 'stick' && s.longDir === 'vertical',
        subclass: {
            COLUMN: () => true,
        },
        ifc: { pset: 'Pset_ColumnCommon', qto: 'Qto_ColumnBaseQuantities', uri: uri('IfcColumn') },
    },

    IfcMember: {
        hosts: ['IfcWall', 'IfcRoof', 'IfcSlab', 'IfcStair', 'IfcWindow', 'IfcDoor', 'IfcBuildingStorey', 'IfcElementAssembly'],
        name: {
            stud: 'STUD', stijl: 'STUD', endstud: 'STUD', jack: 'STUD', king: 'STUD', cripple: 'STUD',
            plate: 'PLATE', topplate: 'PLATE', bottomplate: 'PLATE', soleplate: 'PLATE', regel: 'PLATE', hoofdregel: 'PLATE', voetregel: 'PLATE',
            rafter: 'RAFTER', spar: 'RAFTER', sparren: 'RAFTER', purlin: 'PURLIN', gording: 'PURLIN', nok: 'PURLIN', ridge: 'PURLIN',
            brace: 'BRACE', schoor: 'BRACE', post: 'POST', stringer: 'STRINGER', mullion: 'MULLION', collar: 'COLLAR', strut: 'STRUT',
            sill: 'MEMBER:SILL', dorpel: 'MEMBER:SILL', block: 'MEMBER:BLOCKING', blocking: 'MEMBER:BLOCKING',
            nogging: 'MEMBER:BLOCKING', klos: 'MEMBER:BLOCKING', member: null, lat: 'MEMBER:BATTEN', batten: 'MEMBER:BATTEN',
        },
        shape: s => s.class === 'stick' || (s.class === 'block' && s.relLength < T.SHORT_MEMBER_RATIO),
        // order matters: blocking before rafter (roof blocks are sloped), plate before stud (raking plates)
        subclass: {
            MEMBER: n => n.relLength < T.SHORT_MEMBER_RATIO && !n.alongDominant,
            PLATE: (n, ctx) => ctx.host.entity === 'IfcWall' && n.longDir !== 'vertical' && (n.touches.has('top') || n.touches.has('bottom')),
            STUD: (n, ctx) => ctx.host.entity === 'IfcWall' && n.longDir === 'vertical',
            BRACE: (n, ctx) => ctx.host.entity === 'IfcWall' && n.longDir === 'sloped',
            RAFTER: (n, ctx) => ctx.host.entity === 'IfcRoof' && n.longDir === 'sloped',
            PURLIN: (n, ctx) => ctx.host.entity === 'IfcRoof' && n.longDir === 'horizontal',
            STRINGER: (n, ctx) => ctx.host.entity === 'IfcStair',
            POST: n => n.longDir === 'vertical',
        },
        objectType: {
            SILL: (n, ctx, type) => type === 'MEMBER' && n.spansOpening === 'below',
            BLOCKING: (n, ctx, type) => type === 'MEMBER' && n.relLength < T.SHORT_MEMBER_RATIO && !n.alongDominant,
        },
        ifc: { pset: 'Pset_MemberCommon', qto: 'Qto_MemberBaseQuantities', uri: uri('IfcMember') },
    },

    // make.wall() keeps each opening as a hidden polygon named 'opening<i>'. By name only.
    IfcOpeningElement: {
        hosts: ['IfcWall', 'IfcSlab', 'IfcRoof'],
        kinds: ['polygon'],
        name: { opening: 'OPENING', sparing: 'OPENING', recess: 'RECESS', uitsparing: 'RECESS' },
        ifc: { uri: uri('IfcOpeningElement') },
    },

    // By name only: shapes that are not cheap to recognise.
    IfcStair: { hosts: ['IfcBuildingStorey'], name: { stair: null, stairs: null, trap: null }, ifc: { uri: uri('IfcStair') } },
    IfcRamp: { hosts: ['IfcBuildingStorey'], name: { ramp: null, helling: null }, ifc: { uri: uri('IfcRamp') } },
    IfcRailing: { hosts: ['IfcBuildingStorey', 'IfcStair', 'IfcRamp'], name: { railing: null, handrail: 'HANDRAIL', balustrade: 'BALUSTRADE', leuning: null, balustrade_nl: null }, ifc: { uri: uri('IfcRailing') } },
    IfcChimney: { hosts: ['IfcBuildingStorey', 'IfcRoof'], name: { chimney: null, schoorsteen: null }, ifc: { uri: uri('IfcChimney') } },
    IfcShadingDevice: { hosts: ['IfcBuildingStorey', 'IfcWall', 'IfcRoof'], name: { shading: null, awning: 'AWNING', louvre: 'JALOUSIE', shutter: 'SHUTTER', zonwering: null, luifel: 'AWNING' }, ifc: { uri: uri('IfcShadingDevice') } },
    IfcPile: { hosts: ['IfcBuildingStorey', 'IfcSite'], name: { pile: null, paal: null, heipaal: 'DRIVEN' }, ifc: { uri: uri('IfcPile') } },
    IfcDiscreteAccessory: { hosts: ['*'], name: { bracket: 'BRACKET', anchor: 'ANCHORPLATE', hanger: null, shoe: 'SHOE', hoekanker: 'BRACKET' }, ifc: { uri: uri('IfcDiscreteAccessory') } },
    IfcFurniture: { hosts: ['IfcBuildingStorey'], name: { table: 'TABLE', tafel: 'TABLE', chair: 'CHAIR', stoel: 'CHAIR', desk: 'DESK', bureau: 'DESK', bed: 'BED', shelf: 'SHELF', kast: 'SHELF', sofa: 'SOFA', bank: 'SOFA' }, ifc: { uri: uri('IfcFurniture') } },

    // Fallback for a container that nothing above claimed, when its shapes are parts rather than elements.
    IfcElementAssembly: {
        hosts: ['*'],
        name: { assembly: null, frame: null, truss: 'TRUSS', spant: 'TRUSS' },
        children: c => c.solids.length >= 2,
        ifc: { uri: uri('IfcElementAssembly') },
    },

    // Fallback for a solid that nothing above claimed. Every one of these is listed in the report.
    IfcBuildingElementProxy: {
        hosts: ['*'],
        shape: () => true,
        ifc: { uri: uri('IfcBuildingElementProxy') },
    },
}

/** Elements that stand directly on a storey. A container holding only these (and walls) is a storey. */
const STOREY_LEVEL = new Set<string>([
    'IfcWall', 'IfcSlab', 'IfcRoof', 'IfcFooting', 'IfcColumn', 'IfcBeam', 'IfcStair', 'IfcRamp', 'IfcRailing',
    'IfcWindow', 'IfcDoor', 'IfcElementAssembly', 'IfcFurniture', 'IfcChimney',
])

/** Entities whose shapes are all parts of them: sub-layers below these dissolve. */
const ELEMENT_HOSTS = new Set<string>(['IfcWall', 'IfcSlab', 'IfcRoof', 'IfcFooting', 'IfcStair', 'IfcRamp', 'IfcWindow', 'IfcDoor', 'IfcElementAssembly'])

function uri(entity: string): string
{
    return `https://identifier.buildingsmart.org/uri/buildingsmart/ifc/4.3/class/${entity}`
}

//// 2. TYPES ////

export type IfcEntity =
    | 'IfcBuildingStorey' | 'IfcFooting' | 'IfcRoof' | 'IfcWall' | 'IfcSlab' | 'IfcBuildingElementPart'
    | 'IfcWindow' | 'IfcDoor' | 'IfcMechanicalFastener' | 'IfcCovering' | 'IfcPlate' | 'IfcBeam' | 'IfcColumn'
    | 'IfcMember' | 'IfcOpeningElement' | 'IfcStair' | 'IfcRamp' | 'IfcRailing' | 'IfcChimney' | 'IfcShadingDevice'
    | 'IfcPile' | 'IfcDiscreteAccessory' | 'IfcFurniture' | 'IfcElementAssembly' | 'IfcBuildingElementProxy'

export type IfcHost = IfcEntity | 'IfcBuilding' | 'IfcSite' | '*'

export interface EntityRule
{
    hosts: ReadonlyArray<IfcHost>
    /** Shape kinds this entity can be. Default: solids only */
    kinds?: ReadonlyArray<ShapeKind>
    /** name token -> 'PREDEFINEDTYPE' or 'PREDEFINEDTYPE:ObjectType', or null to decide by `subclass` */
    name?: Record<string, string | null>
    shape?: (s: LeafFeatures, ctx: Ctx) => boolean
    /** Fills an opening of the host that looks like this. The filling gets no geometry of its own */
    opening?: (o: OpeningFeatures, ctx: Ctx) => boolean
    children?: (c: ChildrenFeatures, ctx: Ctx) => boolean
    subclass?: Record<string, (n: NodeFeatures, ctx: Ctx) => boolean>
    objectType?: Record<string, (n: NodeFeatures, ctx: Ctx, predefinedType: string) => boolean>
    ifc: { pset?: string; qto?: string; uri: string }
}

export type Vec3 = [number, number, number]
export type Dir = 'vertical' | 'horizontal' | 'sloped'
export type ShapeClass = 'stick' | 'board' | 'block'
export type ShapeKind = 'solid' | 'polygon' | 'curve' | 'point'
export type Touch = 'top' | 'bottom' | 'face' | 'side'

export interface NodeName
{
    /** As in the scene, without the component prefix */
    raw: string
    /** Lower case words, position words and numbers dropped, singular */
    tokens: string[]
    /** Last token: in 'openingKingStudLeft' that is 'stud' */
    head: string | null
    /** The name was plural ('walls', 'studs') */
    plural: boolean
}

/** What a leaf predicate sees: the shape itself and where it sits in its host */
export interface LeafFeatures
{
    isContainer: false
    path: string
    name: NodeName
    kind: ShapeKind
    subtype: string | null
    material: string | null
    /** Sorted extents: thickness <= width <= length */
    thickness: number
    width: number
    length: number
    /** World directions of the long and the thin axis */
    long: Vec3
    thin: Vec3
    longDir: Dir
    thinDir: Dir
    class: ShapeClass
    /** volume / oriented box volume */
    fill: number
    isBox: boolean
    /** Bounding box z range and height */
    base: number
    top: number
    height: number
    // -- relative to the host element --
    /** Board plane parallel to the host plane */
    plane: 'inPlane' | 'crossPlane'
    /** Which parts of the host envelope this shape touches */
    touches: Set<Touch>
    /** Extent across the host thickness */
    depthInHost: number
    /** Extent in the host plane, across the long axis */
    widthInHost: number
    /** length / median stick length in the host */
    relLength: number
    /** Long axis runs with the dominant sticks of the host */
    alongDominant: boolean
    /** A horizontal stick framing an opening of the host from above or below */
    spansOpening: 'above' | 'below' | null
}

/** What an `opening` predicate sees: an opening of the host (make.wall() keeps them as hidden polygons) */
export interface OpeningFeatures
{
    isContainer: false
    path: string
    name: NodeName
    /** Clear width along the host and clear height */
    width: number
    height: number
    /** Bottom of the opening above the base of the host */
    sill: number
    /** Top of the host above the top of the opening */
    head: number
}

/** What a container predicate sees: everything below it */
export interface ChildrenFeatures
{
    isContainer: true
    path: string
    name: NodeName
    /** Visible solids at any depth below the container */
    solids: LeafFeatures[]
    sticks: { all: LeafFeatures[]; vertical: LeafFeatures[]; horizontal: LeafFeatures[]; sloped: LeafFeatures[] }
    boards: LeafFeatures[]
    blocks: LeafFeatures[]
    aggregate: Aggregate
    /** Entities of the direct child layers and components, as they would resolve on a storey */
    childEntities: string[]
    materials: { has(group: string): boolean; majority: string | null }
    /** Distinct slope directions of the sloped sticks: 2 for a gable roof */
    slopeSets: number
    // leaf-only fields, absent on containers, so subclass predicates can be shared
    [key: string]: any
}

export type NodeFeatures = LeafFeatures | ChildrenFeatures | (LeafFeatures & ChildrenFeatures)

/** A container's envelope measured in its own frame: u along its dominant horizontal sticks, w up */
export interface Aggregate
{
    frame: { u: Vec3; v: Vec3; w: Vec3 }
    min: Vec3
    max: Vec3
    length: number
    thickness: number
    height: number
    isThin: boolean
    thinDir: Dir
    base: number
    top: number
}

export interface Ctx
{
    host: { entity: string; path: string } & ChildrenFeatures
    storey: { elevation: number }
    units: ModelUnits
    /** Millimetres in model units */
    mm(n: number): number
}

//// 3. MEASURE ////

/** Plain, JSON-serialisable measurements of one shape. Derived features are computed from these, so a
 *  dump of a real scene can be re-classified in milliseconds after any change in section 1. */
export interface RawShape
{
    type: string
    kind: ShapeKind
    subtype: string | null
    hidden: boolean
    /** Oriented box: centre, unit axes and half extents per axis */
    obb: { center: Vec3; axes: [Vec3, Vec3, Vec3]; half: Vec3 } | null
    bbox: { min: Vec3; max: Vec3 } | null
    volume: number | null
    material: string | null
    /** The box came from the recipe (exact), not from PCA */
    exact: boolean
}

export interface FeatureNode
{
    path: string
    /** Node name as in the scene */
    name: string
    /** The `<ref>_` prefix component scripts put on every node below their root */
    componentRef?: string
    explicit?: ExplicitTag
    hidden?: boolean
    shape?: RawShape
    children: FeatureNode[]
}

export interface ExplicitTag { tag: string; opts?: Record<string, any> }

export interface FeatureTree
{
    version: 1
    units: ModelUnits
    root: FeatureNode
}

/** Walk a scene and measure every shape. The only function here that touches geometry. */
export function measureScene(root: any, units: ModelUnits): FeatureTree
{
    const visit = (node: any, hiddenAbove: boolean): FeatureNode =>
    {
        const hidden = hiddenAbove || node.style?.visible === false
        const shape = node.shape?.() ?? null
        const explicit = readExplicit(node._is) ?? readExplicit(shape?.metadata?.is ?? shape?._is)
        const out: FeatureNode = { path: node.path(), name: node.name ?? '', children: [] }
        if (explicit) out.explicit = explicit
        if (hidden) out.hidden = true
        if (shape) out.shape = measureShape(shape)
        out.children = (node.children?.() ?? []).map((c: any) => visit(c, hidden))
        const ref = componentRefOf(out)
        if (ref) out.componentRef = ref
        return out
    }
    return { version: 1, units, root: visit(root, false) }
}

export function measureShape(shape: any): RawShape
{
    const type: string = shape.type
    const kind: ShapeKind = shape.isSolid?.() ? 'solid'
        : (type === 'Polygon' || type === 'Face') ? 'polygon'
        : (type === 'Curve' || type === 'Edge' || type === 'Wire') ? 'curve'
        : 'point'
    const raw: RawShape = {
        type, kind,
        subtype: safe(() => shape.subtype?.() ?? null, null),
        hidden: shape.style?.visible === false,
        obb: null, bbox: null, volume: null, material: null, exact: false,
    }
    if (kind === 'point') return raw

    const bb = safe(() => shape.bbox?.(), null)
    if (bb) raw.bbox = { min: roundVec(toVec(bb.min())), max: roundVec(toVec(bb.max())) }
    if (kind !== 'solid') return raw

    raw.volume = round(safe(() => shape.volume(), 0))
    raw.material = safe(() => shape.material?.()?.group ?? null, null)

    const cuboid = safe(() => { const r = recipeOf(shape); return r ? asCuboid(resolveRecipe(r)) : null }, null)
    if (cuboid)
    {
        raw.obb = { center: roundVec(cuboid.center as Vec3), axes: cuboid.axes.map(a => roundVec(a as Vec3, 6)) as any, half: roundVec(cuboid.size.map(s => s / 2) as Vec3) }
        raw.exact = true
    }
    else
    {
        const o = safe(() => shape.obbox(), null)
        if (o && isBrepShape(shape))
        {
            raw.obb = { center: roundVec(toVec(o.center())), axes: [o.xDir(), o.yDir(), o.zDir()].map(a => roundVec(toVec(a), 6)) as any, half: roundVec([o.width() / 2, o.depth() / 2, o.height() / 2]) }
        }
        else if (o)
        {
            raw.obb = { center: roundVec(toVec(o.center())), axes: o.axes().map((a: any) => roundVec(toVec(a), 6)) as any, half: roundVec(o.halfExtents() as Vec3) }
        }
    }
    return raw
}

function readExplicit(is: any): ExplicitTag | undefined
{
    if (!is) return undefined
    if (typeof is === 'string') return { tag: is }
    if (typeof is.tag === 'string') return { tag: is.tag, opts: is.opts }
    return undefined
}

/** A component root is a node whose descendants all start with the same `<ref>_` prefix. */
function componentRefOf(node: FeatureNode): string | undefined
{
    const names: string[] = []
    const collect = (n: FeatureNode) => n.children.forEach(c => { names.push(c.name); collect(c) })
    collect(node)
    if (names.length === 0 || !names[0].startsWith('./')) return undefined
    let prefix = names[0]
    names.forEach(n => { while (!n.startsWith(prefix)) prefix = prefix.slice(0, -1) })
    const cut = prefix.lastIndexOf('_')
    return cut > 2 ? prefix.slice(0, cut + 1) : undefined
}

//// 4. DERIVE ////

/** Split a node name into matchable words: camelCase, '_', spaces, digits; position words dropped. */
export function tokeniseName(raw: string, componentRef?: string): NodeName
{
    let name = raw ?? ''
    if (componentRef && name.startsWith(componentRef)) name = name.slice(componentRef.length)
    name = name.replace(/\[\d+\]$/, '')
    const words = name
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
        .replace(/([A-Za-z])(\d)/g, '$1 $2')
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(w => w && !/^\d+$/.test(w) && !NAME_STOPWORDS.has(w))
    const singular = (w: string) => w.endsWith('ies') ? w.slice(0, -3) + 'y'
        : (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) ? w.slice(0, -1) : w
    const tokens = words.map(singular)
    const head = words.length ? words[words.length - 1] : null
    return { raw: name, tokens, head: head ? singular(head) : null, plural: !!head && singular(head) !== head }
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const DEG = Math.PI / 180

function directionOf(v: Vec3): Dir
{
    const fromZ = Math.acos(Math.min(1, Math.abs(v[2]))) / DEG
    return fromZ <= T.VERTICAL_DEG ? 'vertical' : fromZ >= 90 - T.HORIZONTAL_DEG ? 'horizontal' : 'sloped'
}

/** Min and max of a shape projected on a unit direction */
function extentAlong(s: RawShape, d: Vec3): [number, number]
{
    if (s.obb)
    {
        const c = dot(s.obb.center, d)
        const r = s.obb.axes.reduce((acc, a, i) => acc + Math.abs(dot(a, d)) * s.obb.half[i], 0)
        return [c - r, c + r]
    }
    if (s.bbox)
    {
        const { min, max } = s.bbox
        const corners: Vec3[] = [0, 1, 2, 3, 4, 5, 6, 7].map(i => [i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]])
        const p = corners.map(c => dot(c, d))
        return [Math.min(...p), Math.max(...p)]
    }
    return [0, 0]
}

/** Features of a shape on its own. Host-relative fields get neutral values until a host is known. */
function deriveShape(node: FeatureNode, name: NodeName): LeafFeatures | null
{
    const s = node.shape
    if (!s || !s.obb) return null
    const dims = s.obb.half.map((h, i) => ({ size: 2 * h, axis: s.obb!.axes[i] })).sort((a, b) => a.size - b.size)
    const [t, w, l] = dims.map(d => d.size)
    const cls: ShapeClass = (l / Math.max(w, 1e-9) >= T.STICK_MIN_LENGTH_RATIO && w / Math.max(t, 1e-9) <= T.STICK_MAX_SECTION_ASPECT) ? 'stick'
        : (w / Math.max(t, 1e-9) >= T.BOARD_MIN_ASPECT) ? 'board'
        : 'block'
    const boxVolume = t * w * l
    const fill = boxVolume > 0 ? Math.min(1, (s.volume ?? 0) / boxVolume) : 0
    const base = s.bbox?.min[2] ?? extentAlong(s, [0, 0, 1])[0]
    const top = s.bbox?.max[2] ?? extentAlong(s, [0, 0, 1])[1]
    return {
        isContainer: false,
        path: node.path, name, kind: s.kind, subtype: s.subtype, material: s.material,
        thickness: t, width: w, length: l,
        long: dims[2].axis, thin: dims[0].axis,
        longDir: directionOf(dims[2].axis), thinDir: directionOf(dims[0].axis),
        class: cls, fill, isBox: fill >= T.BOX_FILL,
        base, top, height: top - base,
        plane: 'inPlane', touches: new Set(), depthInHost: t, widthInHost: w, relLength: 1, alongDominant: true, spansOpening: null,
    }
}

/** Group unit directions that differ less than SAME_DIRECTION_DEG, ignoring sign; weight by `weight`. */
function directionClusters(items: Array<{ dir: Vec3; weight: number }>, signed = false): Array<{ dir: Vec3; weight: number }>
{
    const cos = Math.cos(T.SAME_DIRECTION_DEG * DEG)
    const clusters: Array<{ dir: Vec3; weight: number }> = []
    items.forEach(item =>
    {
        const hit = clusters.find(c => (signed ? dot(c.dir, item.dir) : Math.abs(dot(c.dir, item.dir))) >= cos)
        if (hit) hit.weight += item.weight
        else clusters.push({ dir: item.dir, weight: item.weight })
    })
    return clusters.sort((a, b) => b.weight - a.weight)
}

function normalize(v: Vec3): Vec3
{
    const n = Math.hypot(v[0], v[1], v[2])
    return n > 1e-12 ? [v[0] / n, v[1] / n, v[2] / n] : [1, 0, 0]
}

/** Everything a container predicate needs, from the visible solids below it. */
function deriveChildren(node: FeatureNode, name: NodeName, solids: LeafFeatures[], raws: Map<string, RawShape>, childEntities: string[]): ChildrenFeatures
{
    const sticks = solids.filter(s => s.class === 'stick')

    // frame: u along the dominant horizontal direction, w up
    const horizontal = directionClusters(solids
        .filter(s => s.longDir === 'horizontal')
        .map(s => ({ dir: normalize([s.long[0], s.long[1], 0]), weight: s.length })))
    const slopedFlat = directionClusters(sticks
        .filter(s => s.longDir === 'sloped')
        .map(s => ({ dir: normalize([s.long[0], s.long[1], 0]), weight: s.length })))
    const u: Vec3 = horizontal[0]?.dir ?? slopedFlat[0]?.dir ?? [1, 0, 0]
    const w: Vec3 = [0, 0, 1]
    const v: Vec3 = [-u[1], u[0], 0]

    const min: Vec3 = [Infinity, Infinity, Infinity]
    const max: Vec3 = [-Infinity, -Infinity, -Infinity]
    solids.forEach(s =>
    {
        const raw = raws.get(s.path)!;
        [u, v, w].forEach((d, i) =>
        {
            const [lo, hi] = i === 2 && raw.bbox ? [raw.bbox.min[2], raw.bbox.max[2]] : extentAlong(raw, d)
            min[i] = Math.min(min[i], lo)
            max[i] = Math.max(max[i], hi)
        })
    })
    const size = solids.length ? [max[0] - min[0], max[1] - min[1], max[2] - min[2]] : [0, 0, 0]
    const order = [0, 1, 2].sort((a, b) => size[a] - size[b])
    const isThin = size[order[1]] > 0 && size[order[0]] / size[order[1]] <= T.CONTAINER_THIN_RATIO

    // slope sets: sloped sticks grouped by the horizontal direction they rise towards
    const slopeItems = sticks.filter(s => s.longDir === 'sloped').map(s =>
    {
        const up: Vec3 = s.long[2] < 0 ? [-s.long[0], -s.long[1], -s.long[2]] : s.long
        return { dir: normalize([up[0], up[1], 0]), weight: s.length }
    })
    const slopeClusters = directionClusters(slopeItems, true)
    const slopeTotal = slopeItems.reduce((a, b) => a + b.weight, 0)

    const groups = solids.map(s => s.material).filter(Boolean) as string[]
    const counts = new Map<string, number>()
    groups.forEach(g => counts.set(g, (counts.get(g) ?? 0) + 1))
    const majority = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]

    return {
        isContainer: true,
        path: node.path, name, solids,
        sticks: {
            all: sticks,
            vertical: sticks.filter(s => s.longDir === 'vertical'),
            horizontal: sticks.filter(s => s.longDir === 'horizontal'),
            sloped: sticks.filter(s => s.longDir === 'sloped'),
        },
        boards: solids.filter(s => s.class === 'board'),
        blocks: solids.filter(s => s.class === 'block'),
        aggregate: {
            frame: { u, v, w }, min, max,
            length: size[0], thickness: size[1], height: size[2],
            isThin, thinDir: order[0] === 2 ? 'vertical' : 'horizontal',
            base: min[2], top: max[2],
        },
        childEntities,
        materials: { has: g => counts.has(g), majority: majority && majority[1] > solids.length / 2 ? majority[0] : null },
        slopeSets: slopeClusters.filter(c => c.weight >= 0.2 * slopeTotal).length,
        // neutral leaf fields, so a subclass predicate written for leaves reads false on a container
        touches: new Set(), relLength: 1, alongDominant: true, spansOpening: null, base: min[2], top: max[2], height: size[2],
    }
}

/** Fill in where a leaf sits in its host element. */
function placeInHost(leaf: LeafFeatures, raw: RawShape, host: ChildrenFeatures, openings: RawShape[], mm: (n: number) => number): LeafFeatures
{
    const { u, v, w } = host.aggregate.frame
    const tol = mm(T.ENVELOPE_TOL_MM)
    const [u0, u1] = extentAlong(raw, u)
    const [v0, v1] = extentAlong(raw, v)
    const [w0, w1] = raw.bbox ? [raw.bbox.min[2], raw.bbox.max[2]] : extentAlong(raw, w)
    const agg = host.aggregate
    const thinAxis = agg.thinDir === 'vertical' ? 2 : 1
    const [t0, t1] = thinAxis === 2 ? [w0, w1] : [v0, v1]
    const depth = t1 - t0

    const touches = new Set<Touch>()
    if (w1 >= agg.max[2] - tol) touches.add('top')
    if (w0 <= agg.min[2] + tol) touches.add('bottom')
    if (depth < 0.67 * (agg.max[thinAxis] - agg.min[thinAxis]) && (t0 <= agg.min[thinAxis] + tol || t1 >= agg.max[thinAxis] - tol)) touches.add('face')
    if (u0 <= agg.min[0] + tol || u1 >= agg.max[0] - tol) touches.add('side')

    const inPlaneWidth = leaf.longDir === 'vertical' ? u1 - u0 : leaf.longDir === 'horizontal' ? (thinAxis === 2 ? v1 - v0 : w1 - w0) : Math.min(u1 - u0, w1 - w0)
    const hostThin: Vec3 = thinAxis === 2 ? w : v

    const stickLengths = host.sticks.all.map(s => s.length).sort((a, b) => a - b)
    const median = stickLengths.length ? stickLengths[Math.floor(stickLengths.length / 2)] : leaf.length
    const dominant = directionClusters(host.sticks.all.map(s => ({ dir: s.long, weight: s.length })))
    const cos = Math.cos(T.SAME_DIRECTION_DEG * DEG)
    const alongDominant = dominant.filter(c => c.weight >= 0.5 * dominant[0].weight).some(c => Math.abs(dot(c.dir, leaf.long)) >= cos)

    let spansOpening: 'above' | 'below' | null = null
    if (leaf.class === 'stick' && leaf.longDir === 'horizontal')
    {
        const adjacent = mm(T.OPENING_ADJACENT_MM)
        openings.forEach(o =>
        {
            if (spansOpening || !o.bbox) return
            const [ou0, ou1] = extentAlong(o, u)
            const overlap = Math.min(u1, ou1) - Math.max(u0, ou0)
            if (overlap < 0.8 * (ou1 - ou0)) return
            if (w0 >= o.bbox.max[2] - tol && w0 - o.bbox.max[2] <= adjacent) spansOpening = 'above'
            else if (w1 <= o.bbox.min[2] + tol && o.bbox.min[2] - w1 <= adjacent) spansOpening = 'below'
        })
    }

    return {
        ...leaf,
        plane: Math.abs(dot(leaf.thin, hostThin)) >= Math.cos(30 * DEG) ? 'inPlane' : 'crossPlane',
        touches,
        depthInHost: depth,
        widthInHost: inPlaneWidth,
        relLength: median > 0 ? leaf.length / median : 1,
        alongDominant,
        spansOpening,
    }
}

//// 5. RESOLVE ////

export interface IfcProduct
{
    path: string
    /** Readable name: path below the host with component prefixes removed */
    label: string
    entity: string
    predefinedType: string
    objectType?: string
    origin: 'explicit' | 'derived' | 'fallback'
    /** What decided it */
    via: 'explicit' | 'name' | 'shape' | 'children' | 'opening' | 'fallback'
    evidence: string
    /** A different verdict from the other kind of evidence (geometry for a named leaf, name for a container) */
    alternative?: string
    conflict?: string
    /** Path of the element or storey this product belongs to */
    host: string
    /** Door or window: path of the opening element it fills */
    fills?: string
    /** Door or window: size of the opening it fills */
    overall?: { width: number; height: number }
    /** Opening element: the box it cuts, in the host frame (u along the host, v across, w up) */
    cut?: { frame: { u: Vec3; v: Vec3; w: Vec3 }; min: Vec3; max: Vec3 }
    /** Solid: volume and sorted extents, in model units */
    measures?: { volume: number; length: number; width: number; thickness: number }
    /** Key into IfcClassification.storeys */
    storey: number
    isContainer: boolean
    classification: Classification
}

export interface IfcStorey
{
    name: string
    path: string | null
    elevation: number
    synthesised: boolean
}

export interface IfcClassification
{
    units: ModelUnits
    storeys: IfcStorey[]
    /** Every product in scene order: element containers, their parts, standalone elements */
    products: IfcProduct[]
    /** Shapes and layers that are not products, with the reason */
    skipped: Array<{ path: string; reason: string }>
    /** Layers that dissolved into the element above them */
    dissolved: string[]
}

/** Measure and classify a scene in one go. */
export function classifyScene(root: any, options: { units: ModelUnits }): { tree: FeatureTree; result: IfcClassification }
{
    const tree = measureScene(root, options.units)
    return { tree, result: classifyTree(tree) }
}

const ENTITY_ALIASES: Record<string, IfcEntity> = {
    storey: 'IfcBuildingStorey', story: 'IfcBuildingStorey', floor: 'IfcSlab', part: 'IfcBuildingElementPart',
    proxy: 'IfcBuildingElementProxy', assembly: 'IfcElementAssembly', opening: 'IfcOpeningElement', fastener: 'IfcMechanicalFastener',
    accessory: 'IfcDiscreteAccessory', buildingstorey: 'IfcBuildingStorey',
}

/** 'ifc:wall', 'ifc:IfcWall', 'IfcWall' -> IfcWall. Unknown tags and other namespaces -> null. */
export function entityOfTag(tag: string): IfcEntity | null
{
    const [ns, rest] = tag.includes(':') ? tag.split(':', 2) : ['ifc', tag]
    if (ns.toLowerCase() !== 'ifc' || !rest) return null
    const key = rest.toLowerCase().replace(/^ifc/, '')
    if (ENTITY_ALIASES[key]) return ENTITY_ALIASES[key]
    return (Object.keys(IFC_ENTITIES) as IfcEntity[]).find(e => e.toLowerCase() === `ifc${key}`) ?? null
}

/** Classify a measured scene. Pure: no geometry, no scene access. */
export function classifyTree(tree: FeatureTree): IfcClassification
{
    const units = tree.units
    const mm = (n: number) => n / (MM_PER_UNIT[units] ?? 1)
    const result: IfcClassification = { units, storeys: [], products: [], skipped: [], dissolved: [] }

    // parent chain for component prefixes and shape lookup
    const raws = new Map<string, RawShape>()
    const refOf = new Map<FeatureNode, string | undefined>()
    const index = (n: FeatureNode, ref: string | undefined) =>
    {
        refOf.set(n, ref)
        if (n.shape) raws.set(n.path, n.shape)
        n.children.forEach(c => index(c, n.componentRef ?? ref))
    }
    index(tree.root, undefined)
    const nameOf = (n: FeatureNode) => tokeniseName(n.name, refOf.get(n))

    const isContainer = (n: FeatureNode) => !n.shape && n.children.length > 0
    const visibleSolids = (n: FeatureNode): FeatureNode[] =>
        n.hidden ? [] : n.shape ? (n.shape.kind === 'solid' && !n.shape.hidden ? [n] : []) : n.children.flatMap(visibleSolids)
    const leafCache = new Map<string, LeafFeatures | null>()
    const leafOf = (n: FeatureNode) =>
    {
        if (!leafCache.has(n.path)) leafCache.set(n.path, deriveShape(n, nameOf(n)))
        return leafCache.get(n.path)!
    }
    const childrenOf = (n: FeatureNode, childEntities: string[] = []) =>
        deriveChildren(n, nameOf(n), visibleSolids(n).map(leafOf).filter(Boolean) as LeafFeatures[], raws, childEntities)

    const entries = Object.entries(IFC_ENTITIES) as Array<[IfcEntity, EntityRule]>
    const allows = (rule: EntityRule, host: string) => rule.hosts.includes('*') || rule.hosts.includes(host as IfcHost)
    const kindOk = (rule: EntityRule, kind: ShapeKind) => (rule.kinds ?? ['solid']).includes(kind)

    /** First name token, right to left, that names an entity allowed here */
    const byName = (name: NodeName, host: string, kind: ShapeKind | 'container'): { entity: IfcEntity; token: string; value: string | null } | null =>
    {
        for (const token of [...name.tokens].reverse())
        {
            for (const [entity, rule] of entries)
            {
                if (!rule.name || !(token in rule.name) || !allows(rule, host)) continue
                if (kind === 'container' ? !rule.children && !ELEMENT_HOSTS.has(entity) && entity !== 'IfcBuildingStorey' : !kindOk(rule, kind)) continue
                return { entity, token, value: rule.name[token] }
            }
        }
        return null
    }

    const subclassOf = (entity: IfcEntity, n: NodeFeatures, ctx: Ctx, fromName?: string | null): { predefinedType: string; objectType?: string } =>
    {
        const rule = IFC_ENTITIES[entity]
        const [namedType, namedObject] = (fromName ?? '').split(':')
        const predefinedType = namedType || Object.entries(rule.subclass ?? {}).find(([, p]) => safe(() => p(n, ctx), false))?.[0] || 'NOTDEFINED'
        const objectType = namedObject || (namedType ? undefined : Object.entries(rule.objectType ?? {}).find(([, p]) => safe(() => p(n, ctx, predefinedType), false))?.[0])
        return objectType ? { predefinedType, objectType } : { predefinedType }
    }

    const neutralHost = (entity: string, path: string, cf?: ChildrenFeatures): Ctx['host'] =>
        ({ ...(cf ?? childrenOf({ path, name: '', children: [] })), entity, path })

    const product = (p: Omit<IfcProduct, 'classification'>): IfcProduct =>
    {
        const full = {
            ...p,
            classification: {
                tag: `ifc:${p.entity}`,
                origin: p.origin === 'explicit' ? 'explicit' : 'derived',
                rule: `${p.entity}.${p.predefinedType}`,
                params: { predefinedType: p.predefinedType, objectType: p.objectType, via: p.via, alternative: p.alternative, conflict: p.conflict, host: p.host },
                evidence: p.evidence,
            } as Classification,
        }
        result.products.push(full)
        return full
    }

    /** How a container would resolve under `host`, without recording anything */
    const probeContainer = (n: FeatureNode, host: string, ctx: Ctx, deep = true):
        { entity: IfcEntity | null; via: IfcProduct['via']; cf: ChildrenFeatures; named: ReturnType<typeof byName>; explicit?: ExplicitTag; geometric: IfcEntity | null } =>
    {
        const childEntities: string[] = []
        if (deep) n.children.filter(isContainer).forEach(c =>
        {
            const r = probeContainer(c, 'IfcBuildingStorey', ctx, false)
            if (r.entity) childEntities.push(r.entity)
        })
        const cf = childrenOf(n, childEntities)
        const named = byName(cf.name, host, 'container')
        const explicitEntity = n.explicit ? entityOfTag(n.explicit.tag) : null
        if (explicitEntity) return { entity: explicitEntity, via: 'explicit', cf, named, explicit: n.explicit, geometric: null }
        if (cf.solids.length === 0) return { entity: null, via: 'fallback', cf, named, geometric: null }
        const ctxHere: Ctx = { ...ctx, host: neutralHost(host, ctx.host.path, ctx.host) }
        const hits = entries.filter(([e, rule]) => rule.children && e !== 'IfcElementAssembly' && allows(rule, host) && safe(() => rule.children!(cf, ctxHere), false))
        const geometric = (hits.find(([e]) => e === named?.entity) ?? hits[0])?.[0] ?? null
        if (geometric) return { entity: geometric, via: 'children', cf, named, geometric }
        if (named && !cf.name.plural) return { entity: named.entity, via: 'name', cf, named, geometric: null }
        return { entity: null, via: 'fallback', cf, named, geometric: null }
    }

    const leafVerdict = (leaf: LeafFeatures, n: FeatureNode, host: string, ctx: Ctx) =>
    {
        const named = byName(leaf.name, host, leaf.kind)
        const geo = entries.find(([e, rule]) => rule.shape && e !== 'IfcBuildingElementProxy' && allows(rule, host) && kindOk(rule, leaf.kind) && safe(() => rule.shape!(leaf, ctx), false))?.[0] ?? null
        return { named, geo }
    }

    /** The box an opening cuts: the polygon's extent in the host plane, through the full host thickness */
    const openingCut = (raw: RawShape, hostCf: ChildrenFeatures): IfcProduct['cut'] =>
    {
        const agg = hostCf.aggregate
        const { u, v, w } = agg.frame
        const thin = agg.thinDir === 'vertical' ? 2 : 1
        const over = mm(T.OPENING_OVERSHOOT_MM)
        const min: Vec3 = [0, 0, 0]
        const max: Vec3 = [0, 0, 0]
        ;[u, v, w].forEach((d, i) =>
        {
            const [lo, hi] = i === thin ? [agg.min[i] - over, agg.max[i] + over] : i === 2 && raw.bbox ? [raw.bbox.min[2], raw.bbox.max[2]] : extentAlong(raw, d)
            min[i] = lo
            max[i] = hi
        })
        return { frame: { u, v, w }, min, max }
    }

    /** A door or window that fills an opening: the name of the opening decides first, then the `opening` predicates */
    const fillOpening = (n: FeatureNode, nm: NodeName, raw: RawShape, host: string, hostPath: string, ctx: Ctx, storey: number, label: string, hostCf: ChildrenFeatures) =>
    {
        if (!raw.bbox) return
        const [u0, u1] = extentAlong(raw, hostCf.aggregate.frame.u)
        const o: OpeningFeatures = {
            isContainer: false, path: n.path, name: nm,
            width: u1 - u0,
            height: raw.bbox.max[2] - raw.bbox.min[2],
            sill: raw.bbox.min[2] - hostCf.aggregate.base,
            head: hostCf.aggregate.top - raw.bbox.max[2],
        }
        const fillers = entries.filter(([, rule]) => rule.opening && allows(rule, host))
        const byWord = fillers.find(([, rule]) => nm.tokens.some(t => rule.name && t in rule.name))
        const byShape = fillers.find(([, rule]) => safe(() => rule.opening!(o, ctx), false))
        const pick = byWord ?? byShape
        const size = `${Math.round(o.width)} x ${Math.round(o.height)}, sill ${Math.round(o.sill)}`
        if (!pick)
        {
            result.skipped.push({ path: n.path, reason: 'opening without a door or window' })
            return
        }
        const [entity, rule] = pick
        const token = byWord ? nm.tokens.find(t => rule.name && t in rule.name)! : null
        product({ path: `${n.path}#filling`, label, entity, ...subclassOf(entity, o as any, ctx, token ? rule.name![token] : null),
            origin: 'derived', via: byWord ? 'name' : 'opening', evidence: `${token ? `'${token}' · ` : ''}fills the opening, ${size}`,
            fills: n.path, overall: { width: o.width, height: o.height }, host: hostPath, storey, isContainer: false })
    }

    /** Record one leaf shape under a host element or storey */
    const classifyLeaf = (n: FeatureNode, host: string, hostPath: string, ctx: Ctx, storey: number, labelBase: string, hostCf?: ChildrenFeatures, openings: RawShape[] = []) =>
    {
        const raw = n.shape!
        const label = labelOf(n.path, labelBase, refOf)
        if (n.hidden || raw.hidden)
        {
            if (raw.kind === 'polygon')
            {
                // hidden polygons are only products when their name says so (make.wall()'s openings)
                const nm = nameOf(n)
                const named = byName(nm, host, 'polygon')
                if (named)
                {
                    const cut = named.entity === 'IfcOpeningElement' && hostCf ? openingCut(raw, hostCf) : undefined
                    product({ path: n.path, label, entity: named.entity, ...subclassOf(named.entity, { isContainer: false } as any, ctx, named.value),
                        origin: 'derived', via: 'name', evidence: `hidden polygon named '${named.token}'`, host: hostPath, storey, isContainer: false,
                        ...(cut ? { cut } : {}) })
                    if (named.entity === 'IfcOpeningElement' && hostCf) fillOpening(n, nm, raw, host, hostPath, ctx, storey, label, hostCf)
                    return
                }
            }
            result.skipped.push({ path: n.path, reason: raw.kind === 'solid' ? 'hidden solid (a boolean tool)' : `hidden ${raw.kind}` })
            return
        }
        if (raw.kind !== 'solid')
        {
            result.skipped.push({ path: n.path, reason: raw.kind })
            return
        }
        let leaf = leafOf(n)
        if (!leaf)
        {
            result.skipped.push({ path: n.path, reason: 'solid without a measurable box' })
            return
        }
        if (hostCf) leaf = placeInHost(leaf, raw, hostCf, openings, mm)
        const measures = { volume: raw.volume ?? 0, length: leaf.length, width: leaf.width, thickness: leaf.thickness }

        const explicitEntity = n.explicit ? entityOfTag(n.explicit.tag) : null
        if (explicitEntity)
        {
            product({ path: n.path, label, entity: explicitEntity, ...subclassOf(explicitEntity, leaf, ctx, n.explicit!.opts?.predefinedType ?? null),
                origin: 'explicit', via: 'explicit', evidence: `tagged '${n.explicit!.tag}'`, host: hostPath, storey, isContainer: false, measures })
            return
        }

        const { named, geo } = leafVerdict(leaf, n, host, ctx)
        const shapeWords = describeLeaf(leaf, !!hostCf)
        if (named)
        {
            const sub = subclassOf(named.entity, leaf, ctx, named.value)
            const alt = geo && geo !== named.entity ? geo : undefined
            product({ path: n.path, label, entity: named.entity, ...sub, origin: 'derived', via: 'name',
                evidence: `'${named.token}' · ${shapeWords}`, alternative: alt, host: hostPath, storey, isContainer: false, measures })
            return
        }
        if (geo)
        {
            product({ path: n.path, label, entity: geo, ...subclassOf(geo, leaf, ctx), origin: 'derived', via: 'shape',
                evidence: shapeWords, host: hostPath, storey, isContainer: false, measures })
            return
        }
        product({ path: n.path, label, entity: 'IfcBuildingElementProxy', predefinedType: 'NOTDEFINED', origin: 'fallback', via: 'fallback',
            evidence: `nothing matched · ${shapeWords}`, host: hostPath, storey, isContainer: false, measures })
    }

    /** All shapes below an element become its parts; sub-layers dissolve */
    const classifyElementParts = (element: FeatureNode, entity: IfcEntity, cf: ChildrenFeatures, ctx: Ctx, storey: number) =>
    {
        const hostCtx: Ctx = { ...ctx, host: { ...cf, entity, path: element.path } }
        const shapes: FeatureNode[] = []
        const walk = (n: FeatureNode) => n.children.forEach(c =>
        {
            if (c.shape) shapes.push(c)
            else
            {
                if (c.children.length) result.dissolved.push(c.path)
                walk(c)
            }
        })
        walk(element)
        const openings = shapes
            .filter(s => s.shape!.kind === 'polygon' && byName(nameOf(s), entity, 'polygon')?.entity === 'IfcOpeningElement')
            .map(s => s.shape!)
        shapes.forEach(s => classifyLeaf(s, entity, element.path, hostCtx, storey, element.path, cf, openings))
    }

    // -- storeys --
    const storeyCtx = (elevation: number): Ctx => ({ host: neutralHost('IfcBuildingStorey', tree.root.path), storey: { elevation }, units, mm })
    const rootCtx = storeyCtx(0)

    /** Nodes directly under the building, each with how it resolves on a storey */
    type TopItem = { node: FeatureNode; probe?: ReturnType<typeof probeContainer> }
    const explicitStoreys: FeatureNode[] = []
    const topItems: TopItem[] = []
    const collectTop = (n: FeatureNode) => n.children.forEach(c =>
    {
        if (c.hidden) { result.skipped.push({ path: c.path, reason: 'hidden layer' }); return }
        if (!isContainer(c)) { topItems.push({ node: c }); return }
        const probe = probeContainer(c, 'IfcBuildingStorey', rootCtx)
        const storeyByTag = c.explicit && entityOfTag(c.explicit.tag) === 'IfcBuildingStorey'
        const storeyByChildren = !probe.geometric && safe(() => IFC_ENTITIES.IfcBuildingStorey.children!(probe.cf, rootCtx), false)
        if (storeyByTag || storeyByChildren) explicitStoreys.push(c)
        else topItems.push({ node: c, probe })
    })
    collectTop(tree.root)

    // Storey elevations: explicit storeys keep their own; the rest share synthesised storeys by base elevation.
    explicitStoreys.forEach(s =>
    {
        const cf = childrenOf(s)
        result.storeys.push({ name: tokeniseName(s.name).raw || 'Storey', path: s.path, elevation: s.explicit?.opts?.elevation ?? (cf.solids.length ? cf.aggregate.base : 0), synthesised: false })
    })
    const baseOf = (item: TopItem) => item.probe ? item.probe.cf.aggregate.base : (leafOf(item.node)?.base ?? 0)
    const standing = topItems.filter(i => (i.probe ? i.probe.entity !== 'IfcRoof' && i.probe.cf.solids.length > 0 : i.node.shape?.kind === 'solid'))
    const bases = standing.map(baseOf).sort((a, b) => a - b)
    const synthetic: number[] = []
    bases.forEach(b => { if (!synthetic.length || b - synthetic[synthetic.length - 1] >= mm(T.STOREY_MIN_SEPARATION_MM)) synthetic.push(b) })
    if (topItems.length && (synthetic.length || !result.storeys.length))
    {
        (synthetic.length ? synthetic : [0]).forEach((elevation, i) =>
            result.storeys.push({ name: `Storey ${i}`, path: null, elevation, synthesised: true }))
    }
    const syntheticStoreyFor = (base: number, isRoof: boolean) =>
    {
        const candidates = result.storeys.map((s, i) => ({ s, i })).filter(x => x.s.synthesised)
        const tol = mm(T.ENVELOPE_TOL_MM)
        const below = candidates.filter(x => x.s.elevation <= base + tol)
        return (below[below.length - 1] ?? candidates[0])?.i ?? 0
    }

    /** Resolve one node that stands on a storey (or in a dissolved group on a storey) */
    const classifyOnStorey = (n: FeatureNode, storey: number, hostPath: string, probe?: ReturnType<typeof probeContainer>) =>
    {
        const ctx = storeyCtx(result.storeys[storey]?.elevation ?? 0)
        if (!isContainer(n))
        {
            if (n.shape) classifyLeaf(n, 'IfcBuildingStorey', hostPath, ctx, storey, hostPath)
            return
        }
        if (n.hidden) { result.skipped.push({ path: n.path, reason: 'hidden layer' }); return }
        const p = probe ?? probeContainer(n, 'IfcBuildingStorey', ctx)
        const label = labelOf(n.path, hostPath, refOf)
        if (p.cf.solids.length === 0 && !p.explicit)
        {
            const hasShapes = visibleShapesCount(n) > 0
            result.skipped.push({ path: n.path, reason: hasShapes ? 'layer without solids' : 'empty layer' })
            return
        }
        if (p.entity && p.entity !== 'IfcBuildingStorey')
        {
            const sub = subclassOf(p.entity, p.cf, { ...ctx, host: neutralHost('IfcBuildingStorey', hostPath) }, p.via === 'explicit' ? p.explicit?.opts?.predefinedType : p.via === 'name' ? p.named?.value : null)
            const conflict = p.via === 'children' && p.named && p.named.entity !== p.entity ? `name '${p.named.token}' says ${p.named.entity}` : undefined
            product({ path: n.path, label, entity: p.entity, ...sub, origin: p.via === 'explicit' ? 'explicit' : 'derived', via: p.via,
                evidence: p.via === 'explicit' ? `tagged '${p.explicit!.tag}'` : p.via === 'name' ? `'${p.named!.token}' · ${describeChildren(p.cf)}` : describeChildren(p.cf),
                conflict, host: hostPath, storey, isContainer: true })
            if (ELEMENT_HOSTS.has(p.entity)) classifyElementParts(n, p.entity, p.cf, ctx, storey)
            else n.children.forEach(c => classifyOnStorey(c, storey, n.path))
            return
        }
        // Nothing claimed this layer. Its own shapes standing as elements -> it dissolves; parts -> an assembly.
        const childContainers = n.children.filter(c => isContainer(c) && visibleSolids(c).length > 0)
        const directSolids = n.children.filter(c => c.shape?.kind === 'solid' && !c.hidden && !c.shape.hidden)
        const asElements = directSolids.filter(c =>
        {
            const leaf = leafOf(c)
            if (!leaf) return false
            const v = leafVerdict(leaf, c, 'IfcBuildingStorey', ctx)
            const e = v.named?.entity ?? v.geo
            return !!e && STOREY_LEVEL.has(e)
        })
        if (childContainers.length > 0 || directSolids.length < 2 || asElements.length >= directSolids.length / 2 || p.cf.name.plural)
        {
            result.dissolved.push(n.path)
            n.children.forEach(c => classifyOnStorey(c, storey, hostPath))
            return
        }
        product({ path: n.path, label, entity: 'IfcElementAssembly', predefinedType: 'NOTDEFINED', origin: 'fallback', via: 'fallback',
            evidence: `nothing matched · ${describeChildren(p.cf)}`, host: hostPath, storey, isContainer: true })
        classifyElementParts(n, 'IfcElementAssembly', p.cf, ctx, storey)
    }

    explicitStoreys.forEach(s =>
    {
        const i = result.storeys.findIndex(x => x.path === s.path)
        s.children.forEach(c => classifyOnStorey(c, i, s.path))
    })
    topItems.forEach(item =>
    {
        const isRoof = item.probe?.entity === 'IfcRoof'
        const storey = syntheticStoreyFor(baseOf(item), isRoof)
        classifyOnStorey(item.node, storey, tree.root.path, item.probe)
    })

    return result
}

function visibleShapesCount(n: FeatureNode): number
{
    return n.hidden ? 0 : n.shape ? (n.shape.hidden ? 0 : 1) : n.children.reduce((a, c) => a + visibleShapesCount(c), 0)
}

function describeLeaf(s: LeafFeatures, inHost: boolean): string
{
    const words: string[] = [s.class]
    if (s.class === 'board') words.push(`thin ${s.thinDir}`)
    else words.push(s.longDir)
    if (!s.isBox) words.push('not a box')
    if (inHost)
    {
        if (s.touches.has('top')) words.push('touches top')
        if (s.touches.has('bottom')) words.push('touches bottom')
        if (s.spansOpening) words.push(`${s.spansOpening} an opening`)
        if (s.relLength < T.SHORT_MEMBER_RATIO) words.push('short')
    }
    if (s.material) words.push(s.material)
    return words.join(', ')
}

function describeChildren(c: ChildrenFeatures): string
{
    const parts: string[] = []
    const a = c.aggregate
    if (a.isThin) parts.push(`thin ${a.thinDir}`)
    parts.push(`${Math.round(a.length)} x ${Math.round(a.thickness)} x ${Math.round(a.height)}`)
    const s = c.sticks
    if (s.all.length) parts.push(`sticks ${s.vertical.length} vertical, ${s.horizontal.length} horizontal, ${s.sloped.length} sloped`)
    if (c.boards.length) parts.push(`${c.boards.length} boards`)
    if (c.slopeSets) parts.push(`${c.slopeSets} slope set${c.slopeSets > 1 ? 's' : ''}`)
    return parts.join(', ')
}

/** Path below `base`, URI-decoded, component prefixes and the sibling suffix of the root removed */
function labelOf(path: string, base: string, refOf: Map<FeatureNode, string | undefined>): string
{
    const rel = path.startsWith(base + '/') ? path.slice(base.length + 1) : path
    return rel.split('/').map(seg => decodeURIComponent(seg).replace(/^(\.\/[^_]*_)+/, '')).join('/')
}

//// 6. VIEWS ////

/** Readable classification tree: storeys, elements, their parts. Runs of equal parts are collapsed. */
export function explainIfc(result: IfcClassification): string
{
    const lines: string[] = []
    const key = (p: IfcProduct) => `${p.entity}.${p.predefinedType}${p.objectType ? `(${p.objectType})` : ''}`
    const pad = (s: string, n: number) => s.length >= n ? s + ' ' : s + ' '.repeat(n - s.length)
    const L = 64
    const E = 40

    lines.push(`${pad('Building', L)}IfcBuilding (synthesised)`)
    result.storeys.forEach((storey, si) =>
    {
        lines.push(`  ${pad(storey.name, L - 2)}IfcBuildingStorey${storey.synthesised ? ' (synthesised)' : ''} elevation ${round(storey.elevation)}`)
        const top = result.products.filter(p => p.storey === si && !result.products.some(h => h.isContainer && h.path === p.host))
        top.forEach(el =>
        {
            const flags = [el.conflict ? `!! ${el.conflict}` : '', el.alternative ? `(or ${el.alternative})` : ''].filter(Boolean).join(' ')
            lines.push(`    ${pad(el.label, L - 4)}${pad(key(el), E)}${el.via}: ${el.evidence}${flags ? '  ' + flags : ''}`)
            const parts = result.products.filter(p => p.host === el.path)
            // collapse consecutive parts with the same folder, verdict and evidence
            const runs: IfcProduct[][] = []
            parts.forEach(p =>
            {
                const last = runs[runs.length - 1]
                const folder = (x: IfcProduct) => x.label.split('/').slice(0, -1).join('/')
                if (last && folder(last[0]) === folder(p) && key(last[0]) === key(p) && last[0].via === p.via && last[0].evidence === p.evidence
                    && last[0].alternative === p.alternative) last.push(p)
                else runs.push([p])
            })
            runs.forEach(run =>
            {
                const first = run[0]
                const folder = first.label.split('/').slice(0, -1).join('/')
                const names = run.map(p => p.label.split('/').pop()!)
                const shown = names.length <= 3 ? names.join(', ') : `${names[0]} .. ${names[names.length - 1]}`
                const label = `${folder ? folder + '/' : ''}${shown}${run.length > 1 ? ` x${run.length}` : ''}`
                const flags = first.alternative ? `(or ${first.alternative})` : ''
                lines.push(`      ${pad(label, L - 6)}${pad(key(first), E)}${first.via}: ${first.evidence}${flags ? '  ' + flags : ''}`)
            })
        })
    })

    const hist = ifcHistogram(result)
    lines.push('')
    lines.push('Entities')
    Object.entries(hist).sort((a, b) => a[0].localeCompare(b[0])).forEach(([k, v]) => lines.push(`  ${pad(k, E + 8)}${v}`))
    const proxies = result.products.filter(p => p.entity === 'IfcBuildingElementProxy')
    const conflicts = result.products.filter(p => p.conflict)
    const reasons = new Map<string, number>()
    result.skipped.forEach(s => reasons.set(s.reason, (reasons.get(s.reason) ?? 0) + 1))
    lines.push('')
    lines.push(`Skipped: ${[...reasons.entries()].map(([r, n]) => `${n} ${r}`).join(', ') || 'none'}`)
    lines.push(`Dissolved layers: ${result.dissolved.length}`)
    lines.push(`Proxies: ${proxies.length}${proxies.length ? ' - ' + proxies.map(p => p.label).join(', ') : ''}`)
    lines.push(`Conflicts: ${conflicts.length}${conflicts.length ? ' - ' + conflicts.map(p => `${p.label} (${p.conflict})`).join(', ') : ''}`)
    return lines.join('\n') + '\n'
}

/** Count of products per `Entity.PREDEFINEDTYPE` */
export function ifcHistogram(result: IfcClassification): Record<string, number>
{
    const out: Record<string, number> = {}
    result.products.forEach(p =>
    {
        const k = `${p.entity}.${p.predefinedType}`
        out[k] = (out[k] ?? 0) + 1
    })
    return out
}

//// 7. BUILDING MODEL ////

/** The export, independent of the file format: spatial structure, products, geometry, quantities. */
export interface BuildingModel
{
    name: string
    units: ModelUnits
    storeys: Array<{ key: string; name: string; elevation: number }>
    elements: ModelElement[]
}

export interface ModelElement
{
    /** Scene path; `#filling` for a door or window that fills an opening. Seeds the GlobalId */
    key: string
    name: string
    entity: string
    predefinedType: string
    objectType?: string
    /** Where it lives: contained in a storey, a part of an element, or an opening cutting an element */
    parent: { storey: number } | { element: string } | { voids: string }
    /** Door or window: key of the opening it fills */
    fills?: string
    overall?: { width: number; height: number }
    /** Welded faces in model units, n-gons kept. Empty for elements made of parts */
    bodies: Body[]
    material?: string
    /** Standard quantity set name (Qto_…BaseQuantities) and its values: volume m³, length in model units, weight kg */
    qto?: { name: string; netVolume?: number; length?: number; netWeight?: number }
    /** Written to the 'Archiyou' property set */
    properties: Record<string, string | number>
}

export interface Body { points: Vec3[]; faces: number[][] }

export interface BuildIFCOptions
{
    units: ModelUnits
    /** Project name, the script name in the editor */
    name?: string
    /** Seconds since 1970 for the file header and owner history; 0 keeps the output byte-identical between runs */
    timestamp?: number
    /** Mixed into every GlobalId, so two projects built from the same script do not share ids */
    projectId?: string
    /** Application version in the file */
    version?: string
}

/** Turn a classification into a building model, reading geometry and materials from the live scene. */
export function buildModel(root: any, classification: IfcClassification, options: BuildIFCOptions): BuildingModel
{
    const units = options.units
    const toMetre = (MM_PER_UNIT[units] ?? 1) / 1000
    const nodes = new Map<string, any>()
    const index = (n: any) => { nodes.set(n.path(), n); (n.children?.() ?? []).forEach(index) }
    index(root)

    const containers = new Map(classification.products.filter(p => p.isContainer).map(p => [p.path, p]))
    const nameOf = (p: IfcProduct) =>
    {
        if (p.fills) return `${containers.get(p.host)?.label ?? 'Wall'} ${p.entity === 'IfcDoor' ? 'door' : 'window'}`
        return p.label.split('/').pop() || p.label
    }

    const elements: ModelElement[] = classification.products.map(p =>
    {
        const parent: ModelElement['parent'] = p.entity === 'IfcOpeningElement' && containers.has(p.host) ? { voids: p.host }
            : p.fills ? { storey: p.storey }
            : containers.has(p.host) ? { element: p.host }
            : { storey: p.storey }
        const shape = p.isContainer || p.fills ? null : nodes.get(p.path)?.shape?.() ?? null
        const bodies = p.cut ? [boxBody(p.cut)] : shape && shape.isSolid?.() ? shapeBodies(shape, units) : []
        const material = shape ? safe(() => shape.material?.()?.name ?? undefined, undefined) : undefined
        const properties: Record<string, string | number> = {
            ScenePath: p.path.split('#')[0],
            Classification: `${p.entity}.${p.predefinedType}${p.objectType ? ` (${p.objectType})` : ''}`,
            DecidedBy: p.via,
            Evidence: p.evidence,
        }
        if (p.alternative) properties.Alternative = p.alternative
        if (p.conflict) properties.Conflict = p.conflict
        const carbon = shape ? safe(() => shape.carbon?.(), undefined) : undefined
        if (typeof carbon === 'number' && Number.isFinite(carbon)) properties.EmbodiedCarbonKgCO2e = carbon

        const el: ModelElement = { key: p.path, name: nameOf(p), entity: p.entity, predefinedType: p.predefinedType, parent, bodies, properties }
        if (p.objectType) el.objectType = p.objectType
        if (p.fills) { el.fills = p.fills; el.overall = p.overall }
        if (material) el.material = material
        const qtoName = IFC_ENTITIES[p.entity as IfcEntity]?.ifc.qto
        if (qtoName && p.measures)
        {
            const bound = safe(() => shape?.material?.(), null)
            const kg = bound ? safe(() => (bound as any)._manager?.massKgFor?.((bound as any).material, p.measures!.volume), undefined) : undefined
            el.qto = { name: qtoName, netVolume: p.measures.volume * toMetre ** 3 }
            if (['IfcBeam', 'IfcColumn', 'IfcMember'].includes(p.entity)) el.qto.length = p.measures.length
            if (typeof kg === 'number' && Number.isFinite(kg)) el.qto.netWeight = kg
        }
        return el
    })

    // elements made of parts carry the summed volume of their parts
    elements.filter(e => containers.has(e.key)).forEach(e =>
    {
        const qtoName = IFC_ENTITIES[e.entity as IfcEntity]?.ifc.qto
        const parts = classification.products.filter(p => p.host === e.key && p.measures)
        if (qtoName && parts.length) e.qto = { name: qtoName, netVolume: parts.reduce((a, p) => a + p.measures!.volume, 0) * toMetre ** 3 }
    })

    return {
        name: options.name || 'Archiyou model',
        units,
        storeys: classification.storeys.map((s, i) => ({ key: s.path ?? `storey:${i}`, name: s.name, elevation: s.elevation })),
        elements,
    }
}

/** A shape's faces, welded, in model units. Faces with holes are triangulated; everything else stays an n-gon. */
export function shapeBodies(shape: any, units: ModelUnits): Body[]
{
    const meshes: any[] = isBrepShape(shape)
        ? [brepShapeToMeshup(shape, DEFAULT_MESHING_QUALITY)].flatMap((m: any) => m?.isShapeCollection?.() ? m.toArray() : [m]).filter((m: any) => m?.type === 'Mesh')
        : [shape]
    const eps = 0.001 / (MM_PER_UNIT[units] ?? 1)
    return meshes.map(mesh =>
    {
        const points: Vec3[] = []
        const lookup = new Map<string, number>()
        const faces: number[][] = []
        const indexOf = (x: number, y: number, z: number) =>
        {
            const key = `${Math.round(x / eps)},${Math.round(y / eps)},${Math.round(z / eps)}`
            let i = lookup.get(key)
            if (i === undefined) { i = points.length; points.push([x, y, z]); lookup.set(key, i) }
            return i
        }
        const polygons: any[] = safe(() => mesh.toPolygons?.() ?? [], [])
        polygons.forEach(polygon =>
        {
            let parts = [polygon]
            try { if (polygon.hasHoles?.()) parts = polygon.triangulate() ?? [] } catch { parts = [polygon] }
            parts.forEach(face =>
            {
                const arr: Float64Array = safe(() => face.toArray?.(), null as any)
                if (!arr) return
                const ring: number[] = []
                for (let o = 0; o + 5 < arr.length; o += 6)
                {
                    const i = indexOf(arr[o], arr[o + 1], arr[o + 2])
                    if (ring[ring.length - 1] !== i) ring.push(i)
                }
                if (ring.length > 1 && ring[0] === ring[ring.length - 1]) ring.pop()
                if (new Set(ring).size >= 3) faces.push(ring)
            })
        })
        return { points, faces }
    }).filter(b => b.faces.length > 0)
}

/** A box given in a frame (u, v, w unit axes) as a closed six-face body */
function boxBody(cut: NonNullable<IfcProduct['cut']>): Body
{
    const { frame: { u, v, w }, min, max } = cut
    const at = (a: number, b: number, c: number): Vec3 => [
        u[0] * a + v[0] * b + w[0] * c, u[1] * a + v[1] * b + w[1] * c, u[2] * a + v[2] * b + w[2] * c,
    ]
    const points: Vec3[] = [
        at(min[0], min[1], min[2]), at(max[0], min[1], min[2]), at(max[0], max[1], min[2]), at(min[0], max[1], min[2]),
        at(min[0], min[1], max[2]), at(max[0], min[1], max[2]), at(max[0], max[1], max[2]), at(min[0], max[1], max[2]),
    ]
    return { points, faces: [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]] }
}

//// 8. STEP PHYSICAL FILE ////

/** A value in an ISO 10303-21 entity instance */
export type SPFValue =
    | null                                   // $  unset
    | '*'                                    // *  derived
    | string                                 // 'text'
    | number                                 // REAL
    | { int: number }                        // INTEGER
    | { enum: string }                       // .ENUM.
    | { ref: number }                        // #id
    | { typed: string; value: SPFValue }     // IFCLABEL('x')
    | SPFValue[]                             // (a,b)

/** Collects entity instances and writes an ISO 10303-21 file */
export class SPFWriter
{
    private _lines: string[] = []

    /** Add an entity instance, returns a reference to it */
    add(entity: string, ...args: SPFValue[]): { ref: number }
    {
        const id = this._lines.length + 1
        this._lines.push(`#${id}=${entity.toUpperCase()}(${args.map(formatSPF).join(',')});`)
        return { ref: id }
    }

    get count(): number { return this._lines.length }

    toString(header: { description: string; name: string; timestamp: string; author: string; organization: string; application: string; schema: string }): string
    {
        const s = (v: string) => formatSPF(v)
        return [
            'ISO-10303-21;',
            'HEADER;',
            `FILE_DESCRIPTION((${s(header.description)}),'2;1');`,
            `FILE_NAME(${s(header.name)},${s(header.timestamp)},(${s(header.author)}),(${s(header.organization)}),${s(header.application)},${s(header.application)},'');`,
            `FILE_SCHEMA((${s(header.schema)}));`,
            'ENDSEC;',
            'DATA;',
            ...this._lines,
            'ENDSEC;',
            'END-ISO-10303-21;',
            '',
        ].join('\n')
    }
}

export function formatSPF(v: SPFValue): string
{
    if (v === null || v === undefined) return '$'
    if (v === '*') return '*'
    if (typeof v === 'string') return `'${escapeSPFString(v)}'`
    if (typeof v === 'number') return formatReal(v)
    if (Array.isArray(v)) return `(${v.map(formatSPF).join(',')})`
    if ('int' in v) return String(Math.round(v.int))
    if ('enum' in v) return `.${v.enum}.`
    if ('ref' in v) return `#${v.ref}`
    if ('typed' in v) return `${v.typed.toUpperCase()}(${formatSPF(v.value)})`
    return '$'
}

/** A REAL always has a decimal point: 1. 0.5 1.5E-05 */
export function formatReal(n: number): string
{
    if (!Number.isFinite(n)) return '0.'
    const text = String(Number(n.toPrecision(12)) || 0)
    const [mantissa, exponent] = text.toUpperCase().split('E')
    const m = mantissa.includes('.') ? mantissa : `${mantissa}.`
    return exponent === undefined ? m : `${m}E${exponent.startsWith('-') ? '-' : ''}${exponent.replace(/^[+-]/, '').padStart(2, '0')}`
}

/** Apostrophes and backslashes doubled; anything outside printable ASCII as \X2\hhhh\X0\ (or \X4\ beyond the BMP) */
export function escapeSPFString(text: string): string
{
    let out = ''
    for (const ch of text)
    {
        const code = ch.codePointAt(0)!
        if (ch === "'") out += "''"
        else if (ch === '\\') out += '\\\\'
        else if (code >= 0x20 && code <= 0x7e) out += ch
        else if (code <= 0xffff) out += `\\X2\\${code.toString(16).toUpperCase().padStart(4, '0')}\\X0\\`
        else out += `\\X4\\${code.toString(16).toUpperCase().padStart(8, '0')}\\X0\\`
    }
    return out
}

//// 9. GLOBAL IDS ////

const IFC_BASE64 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$'

/** A deterministic 22-character IFC GlobalId from any seed: the same model path always gets the same id,
 *  so BIM tools can follow an element across exports. 128-bit hash, IFC's compressed base64. */
export function ifcGuid(seed: string): string
{
    const bytes = hash128(seed)
    bytes[6] = (bytes[6] & 0x0f) | 0x40 // shaped like a version 4 UUID, as most tools expect
    bytes[8] = (bytes[8] & 0x3f) | 0x80
    const chars = (value: number, count: number) =>
    {
        let out = ''
        for (let i = count - 1; i >= 0; i--) out += IFC_BASE64[Math.floor(value / 64 ** i) % 64]
        return out
    }
    let guid = chars(bytes[0], 2)
    for (let i = 1; i < 16; i += 3) guid += chars((bytes[i] << 16) + (bytes[i + 1] << 8) + bytes[i + 2], 4)
    return guid
}

/** cyrb128: four 32-bit lanes over the UTF-16 code units, as 16 bytes */
function hash128(text: string): number[]
{
    let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762
    for (let i = 0; i < text.length; i++)
    {
        const k = text.charCodeAt(i)
        h1 = h2 ^ Math.imul(h1 ^ k, 597399067)
        h2 = h3 ^ Math.imul(h2 ^ k, 2869860233)
        h3 = h4 ^ Math.imul(h3 ^ k, 951274213)
        h4 = h1 ^ Math.imul(h4 ^ k, 2716044179)
    }
    h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067)
    h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233)
    h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213)
    h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179)
    h1 ^= (h2 ^ h3 ^ h4); h2 ^= h1; h3 ^= h1; h4 ^= h1
    return [h1, h2, h3, h4].flatMap(h => [(h >>> 24) & 255, (h >>> 16) & 255, (h >>> 8) & 255, h & 255])
}

//// 10. IFC4 FILE ////

/** Metric length units as IfcSIUnit prefixes; the rest are conversion-based units on the metre */
const IFC_LENGTH_UNITS: Record<ModelUnits, { prefix?: string | null; name?: string; metres?: number }> = {
    mm: { prefix: 'MILLI' }, cm: { prefix: 'CENTI' }, dm: { prefix: 'DECI' }, m: { prefix: null }, km: { prefix: 'KILO' },
    inch: { name: 'inch', metres: 0.0254 }, feet: { name: 'foot', metres: 0.3048 }, yd: { name: 'yard', metres: 0.9144 }, mi: { name: 'mile', metres: 1609.344 },
}

/** Entities whose PredefinedType is not their last attribute */
const IFC_ATTRIBUTE_TAIL: Record<string, (e: ModelElement) => SPFValue[]> = {
    IfcDoor: e => [e.overall?.height ?? null, e.overall?.width ?? null, { enum: e.predefinedType }, null, null],
    IfcWindow: e => [e.overall?.height ?? null, e.overall?.width ?? null, { enum: e.predefinedType }, null, null],
    IfcElementAssembly: e => [null, { enum: e.predefinedType }],
    IfcMechanicalFastener: e => [null, null, { enum: e.predefinedType }],
    IfcPile: e => [{ enum: e.predefinedType }, null],
}

/** Write a building model as an IFC4 file (Reference View: tessellated bodies, world coordinates, identity placements). */
export function serializeIFC4(model: BuildingModel, options: BuildIFCOptions): string
{
    const f = new SPFWriter()
    const guid = (seed: string) => ifcGuid(`${options.projectId ?? ''}|${seed}`)
    const timestamp = Math.round(options.timestamp ?? 0)

    // -- header objects --
    const person = f.add('IfcPerson', null, 'Archiyou', null, null, null, null, null, null)
    const org = f.add('IfcOrganization', null, 'Archiyou', null, null, null)
    const personOrg = f.add('IfcPersonAndOrganization', person, org, null)
    const app = f.add('IfcApplication', org, options.version ?? '0.9.0', 'Archiyou', 'Archiyou')
    // ADDED requires a LastModifiedDate (IfcOwnerHistory rule CorrectChangeAction)
    const owner = f.add('IfcOwnerHistory', personOrg, app, null, { enum: 'ADDED' }, { int: timestamp }, null, null, { int: timestamp })

    // -- units --
    const length = IFC_LENGTH_UNITS[model.units] ?? IFC_LENGTH_UNITS.mm
    let lengthUnit: { ref: number }
    if (length.metres)
    {
        const metre = f.add('IfcSIUnit', '*', { enum: 'LENGTHUNIT' }, null, { enum: 'METRE' })
        const dims = f.add('IfcDimensionalExponents', { int: 1 }, { int: 0 }, { int: 0 }, { int: 0 }, { int: 0 }, { int: 0 }, { int: 0 })
        const factor = f.add('IfcMeasureWithUnit', { typed: 'IfcLengthMeasure', value: length.metres }, metre)
        lengthUnit = f.add('IfcConversionBasedUnit', dims, { enum: 'LENGTHUNIT' }, length.name!, factor)
    }
    else lengthUnit = f.add('IfcSIUnit', '*', { enum: 'LENGTHUNIT' }, length.prefix ? { enum: length.prefix } : null, { enum: 'METRE' })
    const units = f.add('IfcUnitAssignment', [
        lengthUnit,
        f.add('IfcSIUnit', '*', { enum: 'AREAUNIT' }, null, { enum: 'SQUARE_METRE' }),
        f.add('IfcSIUnit', '*', { enum: 'VOLUMEUNIT' }, null, { enum: 'CUBIC_METRE' }),
        f.add('IfcSIUnit', '*', { enum: 'MASSUNIT' }, { enum: 'KILO' }, { enum: 'GRAM' }),
        f.add('IfcSIUnit', '*', { enum: 'PLANEANGLEUNIT' }, null, { enum: 'RADIAN' }),
    ])

    // -- context and the one placement everything shares --
    const origin = f.add('IfcCartesianPoint', [0, 0, 0])
    const axis = f.add('IfcAxis2Placement3D', origin, null, null)
    const context = f.add('IfcGeometricRepresentationContext', null, 'Model', { int: 3 }, 1e-5, axis, null)
    const body = f.add('IfcGeometricRepresentationSubContext', 'Body', 'Model', '*', '*', '*', '*', context, null, { enum: 'MODEL_VIEW' }, null)
    const project = f.add('IfcProject', guid('project'), owner, model.name, null, null, null, null, [context], units)

    // -- spatial structure --
    const place = (relTo: { ref: number } | null) => f.add('IfcLocalPlacement', relTo, axis)
    const sitePlacement = place(null)
    const site = f.add('IfcSite', guid('site'), owner, 'Site', null, null, sitePlacement, null, null, { enum: 'ELEMENT' }, null, null, null, null, null)
    const buildingPlacement = place(sitePlacement)
    const building = f.add('IfcBuilding', guid('building'), owner, 'Building', null, null, buildingPlacement, null, null, { enum: 'ELEMENT' }, null, null, null)
    const storeys = model.storeys.map(s =>
    {
        const placement = place(buildingPlacement)
        return { placement, ref: f.add('IfcBuildingStorey', guid(`storey|${s.key}`), owner, s.name, null, null, placement, null, null, { enum: 'ELEMENT' }, s.elevation) }
    })
    f.add('IfcRelAggregates', guid('rel|project'), owner, null, null, project, [site])
    f.add('IfcRelAggregates', guid('rel|site'), owner, null, null, site, [building])
    if (storeys.length) f.add('IfcRelAggregates', guid('rel|building'), owner, null, null, building, storeys.map(s => s.ref))

    // -- products, parents before parts --
    const byKey = new Map(model.elements.map(e => [e.key, e]))
    const refs = new Map<string, { ref: { ref: number }; placement: { ref: number } }>()
    const depth = (e: ModelElement): number => 'element' in e.parent ? 1 + depth(byKey.get(e.parent.element)!) : 'voids' in e.parent ? 1 + depth(byKey.get(e.parent.voids)!) : 0
    const ordered = [...model.elements].sort((a, b) => depth(a) - depth(b))
    ordered.forEach(e =>
    {
        const parentKey = 'element' in e.parent ? e.parent.element : 'voids' in e.parent ? e.parent.voids : null
        const relTo = parentKey ? refs.get(parentKey)!.placement : storeys['storey' in e.parent ? e.parent.storey : 0]?.placement ?? buildingPlacement
        const placement = place(relTo)
        const representation = e.bodies.length
            ? f.add('IfcProductDefinitionShape', null, null, [f.add('IfcShapeRepresentation', body, 'Body', 'Tessellation', e.bodies.map(b =>
                f.add('IfcPolygonalFaceSet', f.add('IfcCartesianPointList3D', b.points), null, b.faces.map(face => f.add('IfcIndexedPolygonalFace', face.map(i => ({ int: i + 1 })))), null)))])
            : null
        const tail = IFC_ATTRIBUTE_TAIL[e.entity]?.(e) ?? [{ enum: e.predefinedType }]
        const ref = f.add(e.entity, guid(e.key), owner, e.name, null, e.objectType ?? null, placement, representation, null, ...tail)
        refs.set(e.key, { ref, placement })
    })

    // -- relationships --
    storeys.forEach((s, i) =>
    {
        const contained = model.elements.filter(e => 'storey' in e.parent && e.parent.storey === i).map(e => refs.get(e.key)!.ref)
        if (contained.length) f.add('IfcRelContainedInSpatialStructure', guid(`rel|contains|${model.storeys[i].key}`), owner, null, null, contained, s.ref)
    })
    model.elements.filter(e => model.elements.some(p => 'element' in p.parent && p.parent.element === e.key)).forEach(whole =>
    {
        const parts = model.elements.filter(p => 'element' in p.parent && p.parent.element === whole.key).map(p => refs.get(p.key)!.ref)
        f.add('IfcRelAggregates', guid(`rel|parts|${whole.key}`), owner, null, null, refs.get(whole.key)!.ref, parts)
    })
    model.elements.filter(e => 'voids' in e.parent).forEach(opening =>
        f.add('IfcRelVoidsElement', guid(`rel|voids|${opening.key}`), owner, null, null, refs.get((opening.parent as { voids: string }).voids)!.ref, refs.get(opening.key)!.ref))
    model.elements.filter(e => e.fills && refs.has(e.fills)).forEach(filling =>
        f.add('IfcRelFillsElement', guid(`rel|fills|${filling.key}`), owner, null, null, refs.get(filling.fills!)!.ref, refs.get(filling.key)!.ref))

    // -- materials --
    const materials = new Map<string, ModelElement[]>()
    model.elements.filter(e => e.material).forEach(e => materials.set(e.material!, [...(materials.get(e.material!) ?? []), e]))
    ;[...materials.entries()].forEach(([name, els]) =>
    {
        const material = f.add('IfcMaterial', name, null, null)
        f.add('IfcRelAssociatesMaterial', guid(`rel|material|${name}`), owner, null, null, els.map(e => refs.get(e.key)!.ref), material)
    })

    // -- properties and quantities --
    model.elements.forEach(e =>
    {
        const props = Object.entries(e.properties).map(([k, v]) =>
            f.add('IfcPropertySingleValue', k, null, typeof v === 'number' ? { typed: 'IfcReal', value: v } : { typed: v.length > 255 ? 'IfcText' : 'IfcLabel', value: v }, null))
        const pset = f.add('IfcPropertySet', guid(`pset|${e.key}`), owner, 'Archiyou', null, props)
        f.add('IfcRelDefinesByProperties', guid(`rel|pset|${e.key}`), owner, null, null, [refs.get(e.key)!.ref], pset)
        if (!e.qto) return
        const quantities: Array<{ ref: number }> = []
        if (e.qto.length !== undefined) quantities.push(f.add('IfcQuantityLength', 'Length', null, null, e.qto.length, null))
        if (e.qto.netVolume !== undefined) quantities.push(f.add('IfcQuantityVolume', 'NetVolume', null, null, e.qto.netVolume, null))
        if (e.qto.netWeight !== undefined) quantities.push(f.add('IfcQuantityWeight', 'NetWeight', null, null, e.qto.netWeight, null))
        if (!quantities.length) return
        const qto = f.add('IfcElementQuantity', guid(`qto|${e.key}`), owner, e.qto.name, null, null, quantities)
        f.add('IfcRelDefinesByProperties', guid(`rel|qto|${e.key}`), owner, null, null, [refs.get(e.key)!.ref], qto)
    })

    return f.toString({
        description: 'ViewDefinition [ReferenceView_V1.2]',
        name: `${model.name}.ifc`,
        timestamp: new Date(timestamp * 1000).toISOString().slice(0, 19),
        author: 'Archiyou', organization: 'Archiyou', application: 'Archiyou',
        schema: 'IFC4',
    })
}

/** Classify a scene, build the model and write the IFC4 file. */
export function buildIFC(root: any, options: BuildIFCOptions): { text: string; model: BuildingModel; classification: IfcClassification; tree: FeatureTree }
{
    const { tree, result } = classifyScene(root, { units: options.units })
    const model = buildModel(root, result, options)
    return { text: serializeIFC4(model, options), model, classification: result, tree }
}

//// UTILS ////

function safe<R>(fn: () => R, fallback: R): R
{
    try { const r = fn(); return r === undefined ? fallback : r } catch { return fallback }
}

function toVec(p: any): Vec3
{
    return Array.isArray(p) ? [p[0], p[1], p[2]] : [p?.x ?? 0, p?.y ?? 0, p?.z ?? 0]
}

function round(n: number, decimals = 3): number
{
    const f = 10 ** decimals
    return (Math.round(n * f) / f) || 0
}

function roundVec(v: Vec3, decimals = 3): Vec3
{
    return [round(v[0], decimals), round(v[1], decimals), round(v[2], decimals)]
}
