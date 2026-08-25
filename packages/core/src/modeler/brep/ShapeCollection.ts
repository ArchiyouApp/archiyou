/**
 * 
 *  ShapeCollection: A Collection with Shapes or ShapeCollections
 *   For example when with intersection and splits the Shapes into seperate Shape instances (Vertex, Edge, Wire, Face, Shell etc.)
 *
 *    ShapeCollection makes operating on multiple Shapes as easy as working on single Shapes (Inspired like JTS/GEOS). 
 *    
 *    TODO: Introduce typed ShapeCollections ShapeCollection<Edge> using generics
 */

 
// constants
import { SHAPE_EXTRUDE_DEFAULT_AMOUNT, SHAPE_SCALE_DEFAULT_FACTOR } from '.';

import type { ArchiyouApp, PointLike, PointLikeOrAnyShapeOrCollection,
         ShapeType, AnyShape, AnyShapeOrSequence, AnyShapeOrCollection,AnyShapeCollection, 
         MakeShapeCollectionInput,
         Pivot,AnyShapeSequence, Alignment, Bbox, Side,
         MeshingQualitySettings,ExportGLTFOptions,
         LayoutOrderType, LayoutOptions, 
         DimensionLevelSettings, AnnotationAutoDimStrategy,
         MeshShape, MeshShapeBuffer, MeshShapeBufferStats,
         Annotation, MainAxis, toDXFOptions, toSVGOptions  } from '.' // see types

import { Point, Vector, Shape, Vertex, Edge, Wire, Face, Shell, Solid, Brep } from './index'

// Scene + style come from the mesh kernel — one SceneNode graph and one Style model for both.
import { SceneNode } from '@archiyou/meshup'
import { renderDrawing } from '../svgLayers'
import type { StyleData } from '@archiyou/meshup'
import { Exporter } from './Exporter'
import { BaseAnnotation } from '../../annotator/AnnotatorBaseAnnotation'

import { isCoordArray, isPointLike, isPointLikeSequence, 
      isAnyShape, isAnyShapeCollection, isMainAxis } from './typeguards' // typeguards
 
import { flattenEntitiesToArray, flattenEntities, roundToTolerance } from '.'  // utils


// special libraries
import { Color } from '@archiyou/meshup'
//import { packer } from 'guillotine-packer' // see: https://github.com/tyschroed/guillotine-packer
// import { DxfWriter, Units } from '@tarikjabiri/dxf'; // TODO: after refactor
 
 interface PackerItem {
   name:string
   width:number
   height:number
   shapeIndex:number
 }
 interface PackerResultItem {
   bin:number
   width:number
   height:number
   x:number
   y:number
   item:PackerItem
 }



// Import decorators directly (not via the barrel) — the barrel is a cycle and decorators
// run at class-definition time, before it has finished initialising.
import { checkInput } from './decorators'
import { hostUnits, hostAnnotator, nextName } from './host'
import { getOc } from './index' // OC global getter

 export class ShapeCollection
 {
      /*  ShapeCollection cannot contain other ShapeCollections. Hierarchies live in the
          meshup SceneNode graph — see _layer. */
      /** The OpenCascade module. A lazy getter, not a field: ShapeCollections are constructed
       *  constantly (including before OC is initialised) and only a handful of methods —
       *  toOcCompound() and friends — actually need the kernel. */
      get _oc():any { return getOc() }
      /** Opaque back-reference to the host Modeler — see Shape._modeler and ./host.ts */
      _modeler:any = null;
      /** The scene layer node holding this collection's Shapes, when it is scene-backed.
       *  Mirrors meshup ShapeCollection._layer and is what the @colScene* decorators resolve. */
      _layer:SceneNode|null = null;
      /** Collection name, mirrored onto _layer. */
      _name:string|undefined;
      _parent:AnyShapeOrCollection;
      shapes:Array<AnyShape> = []; // No ShapeCollection here
      _groups:{[key:string]:Array<AnyShape>} = {}; // mechanism to define groups within ShapeCollection (experimental)

      _packerModule:any; // caching of dynamically imported guillotine-packer

      annotations:Array<Annotation> = []; // array of annotations associated with this ShapeCollection
   
      constructor(entities?:MakeShapeCollectionInput, ...args)
      {
         if (entities)
         {
            entities = (Array.isArray(entities) && !isCoordArray(entities)) ? entities.concat(args) : [entities, ...args];
            // NOTE: Array.flat() might be interesting, except it does collapse coord arrays. Manual way to flatten entities?
            entities = flattenEntities(entities); // NOTE: we could also use flattenEntitiesToArray

            this.fromAll(entities);
         }
      }

      /** Manually clear OC Shapes instances - used to make sure memory is released 
       *  NOTE: Please use automatic garbageCollection.targetOcForGarbageCollection() for more generic approach
      */
      _clearOcShapes()
      {
         this.shapes.forEach(s => s._clearOcShape());
      }

      /** Try to convert anything to a ShapeCollection */
      // We use an incremental way of iterating over collections (Arrays, ShapeCollections), testing the entities and adding them
      // IMPORTANT TODO: if new ShapeCollection from existing one - what to do with taking over attributes? 
      @checkInput('MakeShapeCollectionInput', 'auto') // no conversion of types
      fromAll(entities?:MakeShapeCollectionInput):AnyShapeCollection
      {
         // protect against single PointLike
         entities = (Array.isArray(entities) && !isCoordArray(entities)) ? entities : [entities]; 
         entities = flattenEntities(entities); // NOTE: we could also use flattenEntitiesToArray
         
         this._addEntities(entities); // pack all together
         this._setFakeArrayKeys();
         this._setFakeNameKeys();

         return this;
      }

      /** Class method */
      static fromAll(s:any,...args):ShapeCollection
      {
         let entities = (Array.isArray(s) && !isCoordArray(s)) ? s.concat(args) : [s, ...args];
         return new ShapeCollection().fromAll(entities);
      }

      /** Add entities (geometry and shapes) to Shape Collection */
      // Extra: add entities as group to organize shapes inside the ShapeCollection
      @checkInput(['MakeShapeCollectionInput', ['String', null]], ['auto','auto']) // no conversion of types
      _addEntities(entities?:MakeShapeCollectionInput, group?:string):AnyShapeCollection
      {
         if(entities == null)
         {
            return this;
         }
         
         let allEntities = flattenEntitiesToArray(entities);

         // auto grouping strategy: for now only group when incoming entities is a Collection and if a name is given to the collection
         
         allEntities.forEach( es => 
         {
            let addedShapes = []; // keep track of added Shapes for grouping

            if (es === null || es === undefined) // null of undefined
            {
               console.warn('ShapeCollection::_addEntities: Skipped nullish entity!')
            }
            else if(isPointLike(es))
            {
               let vertex = (!(es instanceof Vertex)) ? new Vertex(es as PointLike) : es as Vertex;
               addedShapes.push(vertex);
               this.shapes.push(vertex); // IMPORTANT: don't make new Vertex is already one: otherwise problems with selectors!
            }
            // single ShapeCollection
            else if(isAnyShapeCollection(es))
            {
               // auto grouping - keeps track of the previous collection
               if(!group) // if not already user defined group
               { 
                  const collName = (es as ShapeCollection).getName() as string;
                  group =  (collName !== 'UnnamedShapeCollection') ? collName : null;
               }

               // flatten an given ShapeCollection into this one
               const shapes = (es as ShapeCollection).shapes.filter(s => !s.isEmpty()); // Check for validity of Shapes
               this.shapes = this.shapes.concat(shapes);
               this.annotations = this.annotations.concat((es as ShapeCollection).annotations); // Merge annotations of incoming ShapeCollection too
               addedShapes = addedShapes.concat(shapes);
            }
            else if(isPointLikeSequence(es)) // NOTE: this needs to be later than single ShapeCollection
            {
               const points = new ShapeCollection(es); // bring all point sequences in collection
               points.forEach( e => 
               {
                  if(isPointLike(e))
                  {
                     let vertex = (!(e instanceof Vertex)) ? new Vertex(e) : e;
                     this.shapes.push(vertex);
                     addedShapes.push(vertex);
                  }
                  else if(isAnyShape(e))
                  {
                     if ( !((e as Shape).isEmpty()) )
                     {
                        this.shapes.push(e as Shape);
                        addedShapes.push(e);
                     }
                     else {
                        console.warn(`ShapeCollection::_addEntities: Empty Shape detected: ${e}. Skipped!`);
                     }
                  }
                  else if(isAnyShapeCollection(e))
                  {
                     let vertices = (e as ShapeCollection).getShapesByType('Vertex');
                     this.concat( vertices ); // append all vertices in collection
                     addedShapes = addedShapes.concat(vertices);
                  }
               })
            }
            // single Shape: also protect against empty Shapes
            else if(isAnyShape(es))
            {
               if (!((es as Shape).isEmpty()))
               {
                  this.shapes.push(es as AnyShape);
                  addedShapes.push(es);
               }
               else {
                  console.warn(`ShapeCollection::_addEntities: Empty Shape ("${es.type}") detected. Skipped!`)
               }
            }
            else {
               console.warn(`ShapeCollection::_addEntities: Unknown entity ${es}: Skipped!`);
            }

            // order incoming entities in group (NOTE: can be an array of ShapeCollections)
            if (group)
            {
               if(this._groups[group])
               {
                  this._groups[group] = this._groups[group].concat(addedShapes)
               }
               else {
                  this._groups[group] = addedShapes;
               }
               group = null; // reset
            }
         }
         );

         this._setFakeGroupKeys();

         return this;
      }

      /** Add entities as named group */
      // TODO: organize scene tree too!
      @checkInput([['String', null], 'MakeShapeCollectionInput'], ['auto','auto']) // no conversion of types
      addGroup(group?:string, entities?:MakeShapeCollectionInput):AnyShapeCollection
      {
         let c = this._addEntities(entities, group);
         this._setFakeGroupKeys();
         return c;
      }

      _defineGroup(name:string, shapes?:ShapeCollection)
      {
         if(!shapes){ shapes = this }

         if(!name)
         {
            return null;
         }

         if(this._groups[name])
         {
            this._groups[name] = this._groups[name].concat(shapes.toArray());
         }
         else {
            this._groups[name] = shapes.toArray();
         }

         this._setFakeGroupKeys();
      }

      /** Get available groups in this ShapeCollection */
      groups():Array<string>  
      {
         return Object.keys(this._groups);
      }

      /** Get shapes in group as ShapeCollection */
      getGroup(name:string):ShapeCollection
      {
         if(name)
         {
            return (this._groups[name]) ? new ShapeCollection(this._groups[name]) : null;
         }
         return null;
      }

      /** Alias for getGroup */
      group(name:string):ShapeCollection
      {
         return this.getGroup(name);
      }

      /** Iterate over Shapes by group, ungrouped Shapes are grouped together 
       *    NOTE: for grouping within ShapeCollection see ShapeCollection addGroup()
       *    This is not the same as the global group() function that makes a ShapeCollection
      */
      forEachGroup(func:(groupName:string, groupedShapes:ShapeCollection) => void)
      {
         const allGroupedShapes = new ShapeCollection();
         this.groups().forEach((groupName) => 
         {
            const groupedShapes = this.getGroup(groupName)
            func(groupName, groupedShapes);
            allGroupedShapes.add(groupedShapes);
         })

         // gather ungrouped Shapes as one group
         const nonGroupedShapes = this.shallowCopy().remove(allGroupedShapes)
         if (nonGroupedShapes.length)
         {
            func(null, nonGroupedShapes)
         }
      }


      /** EXPERIMENTAL: try to be compatible with Arrays by setting index keys on this instance */
      _setFakeArrayKeys()
      {
         // remove previous if any
         let i = 0;
         while(true)
         {
            if (this[i])
            {
               delete this[i];
               i++;
            }
            else {
               break;
            }
         }
         // add fake keys
         this.shapes.forEach( (shape,index) => this[index] = shape);
      }

      /** EXPERIMENTAL: Set references to Shapes by name directly on instance */
      _setFakeNameKeys()
      {
         this.shapes.forEach(s => {
            if(s.name() && s[s.name() as string] === undefined) // don't overwrite existing properties
            {
               this[s.name() as string] = s;
            }
         })
      }

      /** EXPERIMENTAL: directly access groups by adding property to instance 
       *   TODO: Check for overwriting properties!
      */
      _setFakeGroupKeys()
      {
         Object.entries(this._groups).forEach(([k,v]) => { 
            if (this[k] === undefined)  // don't set existing props (like shapes) because this will break access to real data
            { 
               this[k] = new ShapeCollection(v) 
            }
         }); 
      }

      //// TRANFORMATIONS ////

      /** Export to OC ListOfStype, used for Splitter algoritm */
      _toOcListOfShape()
      {
         /* OC docs:
               - https://dev.opencascade.org/doc/refman/html/class_n_collection___list.html
         */
         let ocShapeList = new this._oc.TopTools_ListOfShape_1();
         this.shapes.forEach( shape => ocShapeList.Append_1(shape._ocShape));

         return ocShapeList;
      }

      toOcShapes():Array<any>
      {
         return this.shapes.map( shape => shape._ocShape );
      }

      /** Combine all children Shapes into one Compund Shape (for export) */
      toOcCompound()
      {
         /* OC docs: 
            - https://dev.opencascade.org/doc/refman/html/class_topo_d_s___compound.html
            -
         */
         let ocCompound = new this._oc.TopoDS_Compound(); 
         let ocSceneBuilder = new this._oc.BRep_Builder();
         let ocShapes = this.toOcShapes();
         ocSceneBuilder.MakeCompound(ocCompound);
         
         ocShapes.forEach(ocShape => {
            ocSceneBuilder.Add(ocCompound, ocShape);
         })
         
         return ocCompound;
      }

      getShapes():Array<AnyShape>
      {
         return this.shapes;
      }

      //// ARRAY API ////

      /** Array API - for consitent API with Array */
      get length():number
      {
         return this.count();
      }

      /** Array API - For consistency with Array */
      @checkInput('AnyShapeSequence', 'ShapeCollection')
      concat(other:AnyShapeSequence):AnyShapeCollection
      {
         other = other as ShapeCollection;
         this.shapes = this.shapes.concat(other.shapes);
         this.annotations = this.annotations.concat(other.annotations); // Merge annotations of incoming ShapeCollection too
         this._setFakeArrayKeys();
         return this;
      }

      /** Array API - For consistency with Array */
      map(mapFunc: (element:AnyShape, index?:number, array?:Array<AnyShape>) => AnyShape ):AnyShapeCollection
      {
         // !!!! TODO: this functions takes it that we map new Shapes, this is not always the case with map !!!!
         return new ShapeCollection(this.shapes.map(mapFunc) as Array<any>); // avoid TS errors
      }

      /** Array API  */
      every(checkFunc: (element:AnyShape, index?:number, array?:Array<AnyShape>) => boolean ):boolean
      {
         return this.shapes.every(checkFunc);
      }

      /** Add Shape to ShapeCollection */
      @checkInput('AnyShapeOrCollection', 'ShapeCollection')
      add(shapes?:AnyShapeOrSequence, ...args):this
      {
         // TODO: Adding to ShapeCollection is by reference. This makes it not exclusively owned
         // This sometimes leads to bugs, especially in map/forEach loops and global variables (not using let/const)
         this._addEntities([shapes, ...args])
         this._setFakeArrayKeys();

         return this;
      }

      /**  Array API - Add Shape to ShapeCollection*/
      @checkInput('AnyShape', 'auto')
      push(shape:AnyShape):ShapeCollection
      {
         this.add(shape);
         return this;
      }

      /** Add Shape to ShapeCollection but not if it is already in it */
      @checkInput('AnyShapeOrCollection', 'ShapeCollection')
      addUnique(shapes?:ShapeCollection, ...args):this
      {
         const hashes = this.shapes.map(s => s._hashcode());
         const newShapes = shapes.toArray().filter(s => !hashes.includes(s._hashcode()))
         this.add(newShapes);
         return this;
      }

      /** Remove Shapes from ShapeCollection */
      @checkInput('AnyShapeOrCollection', 'ShapeCollection')
      remove(shapes:AnyShapeOrCollection, ...args): ShapeCollection
      {
         let removeShapes = shapes as ShapeCollection;

         this.shapes = this.shapes.filter( s => !removeShapes.has(s));

         // check groups and remove if needed
         Object.values(this._groups).forEach( groupColl => 
         {
            removeShapes.forEach((removeShape) => {
               const indexOf = groupColl.indexOf(removeShape)
               if( indexOf !== -1)
               {
                  groupColl.splice(indexOf, 1)
               }
            })
         })

         this._setFakeArrayKeys();
         this._setFakeGroupKeys();

         return this;
      }

      /** Clear current ShapeCollection */
      empty():this
      {
         this.remove(this);
         return this;
      }



      /** Add Shape at beginning of collection */
      @checkInput('AnyShape', 'auto')
      prepend(shape:AnyShape):ShapeCollection
      {
         this.shapes = [shape].concat(this.shapes);
         return this;
      }


      /** Add Shape to right of current ShapeCollection */
      @checkInput('AnyShape', 'auto')
      addAligned(shape:AnyShape):this
      {
         const NEXT_MARGIN = 10;

         if(this.isEmpty())
         {
            // just add new Shape in center
            this.add(shape.moveToOrigin());
         }
         else {
            // add new Shape next other shapes
            let shapePosition = this.center().add(this.bbox().width() + NEXT_MARGIN + shape.bbox().width());
            this.add(shape.moveTo(shapePosition));
         }

         return this;
      }

      @checkInput(['AnyShapeOrCollection','AnyShapeOrCollection'],['ShapeCollection','ShapeCollection'])
      replace(shapes:AnyShapeOrCollection, newShapes:AnyShapeOrCollection):ShapeCollection
      {
         this.remove(shapes as ShapeCollection)
         this.add(newShapes as ShapeCollection);

         return this;
      }

      //// SHAPE API ////

      /** Set attribute to all shapes */
      attribute(key:string, value:any):AnyShapeCollection
      {
         if(!(typeof(key) === 'string') || !value){ throw new Error(`ShapeCollection::atribute: Please supply a key and value! (ie. attribute('name', 'archiyou'))`) }

         this.forEach(shape => shape.attribute(key,value))

         return this;
      }

      /** Shape API - move all Shapes in ShapeCollection */
      @checkInput('PointLike','Vector') // this automatically transforms Types
      move(vector:PointLike, ...args):AnyShapeCollection
      {
         this.shapes.forEach( shape => shape.move(vector as Vector));

         return this;
      }



      /**  Shape API - Move center of Collection to a given point */
      // NOTE: This might be a bit weird: Moving all Shapes in this Collection to the same coordinate */
      @checkInput('PointLike','Vector') // this automatically transforms Types
      moveTo(to:PointLike, ...args):AnyShapeCollection
      {
         let moveVec = (to as Vector).subtract(this.center().toVector());
         this.shapes.forEach( shape => shape.move(moveVec));

         return this;
      }

      /** Center Shape so that the center of the Shape is at the origin */
      moveToOrigin():AnyShapeCollection
      {
         this.moveTo(0,0,0);
         return this;
      }

      /** Aliass for move along x-direction */
      @checkInput(Number, 'auto')
      moveX(distance:number):this
      {
         this.move(distance)
         return this;
      }

      /** Aliass for move along x-direction */
      @checkInput(Number, 'auto')
      moveY(distance:number):this
      {
         this.move(0,distance,0)
         return this;
      }

      /** Aliass for move along x-direction */
      @checkInput(Number, 'auto')
      moveZ(distance:number):this
      {
         this.move(0,0,distance)
         return this;
      }
      
      /** Move shapes to given x coordinate */
      @checkInput(Number, 'auto')
      moveToX(x:number):this
      {
         this.shapes.forEach(s => s.moveToX(x));
         return this;
      }

      /** Move shapes to given x coordinate */
      @checkInput(Number, 'auto')
      moveToY(y:number):this
      {
         this.shapes.forEach(s => s.moveToY(y));
         return this;
      }

      /** Move shapes to given x coordinate */
      @checkInput(Number, 'auto')
      moveToZ(z:number):this
      {
         this.shapes.forEach(s => s.moveToZ(z));
         return this;
      }

      /** Shape API */
      @checkInput([ [Number,0],[Number,0], [Number,0], ['Pivot', 'center']], [Number,Number,Number,'auto']) // IMPORTANT: not able to directly convert Pivot to Vector because pivot needs current Shape (can that be accessed in decorator?)
      rotateEuler(degX?:number, degY?:number, degZ?:number, pivot?:PointLike):AnyShapeCollection
      {
         if (pivot === 'center'){ pivot = this.center();} // use center of ShapeCollection as pivot, not of individual Shape
         this.shapes.forEach( shape => shape.rotateEuler(degX, degY, degZ, pivot));
         return this;
      }

      /** Shape API */
      @checkInput([ [Number,0],[Number,0], [Number,0], ['Pivot', 'center']], [Number,Number,Number,'auto']) // IMPORTANT: not able to directly convert Pivot to Vector because pivot needs current Shape (can that be accessed in decorator?)
      rotatedEuler(degX?:number, degY?:number, degZ?:number, pivot?:PointLike):AnyShapeCollection
      {
         let newCollection = this.copy();
         if (pivot === 'center'){ pivot = this.center();} // use center of ShapeCollection as pivot, not of individual Shape
         newCollection.shapes.forEach( shape => shape.rotateEuler(degX, degY, degZ, pivot));
         return this;
      }

      /** Shape API - Rotate all Shapes around their centers with a given x,y,z angles */
      @checkInput('PointLike', Vector)
      rotate(r:PointLike, ...args):AnyShapeCollection // allows flattened notation rotate(180,0,-90)
      {
         let rv = r as Vector; // automatically converted to Vector
         let newCollection = new ShapeCollection();
         newCollection.shapes.forEach( shape => shape.rotateX(rv.x).rotateY(rv.y).rotateZ(rv.z) );
         return this;
      }

      /** Shape API - Rotate all Shapes around the x-axis with a given angle and given pivot (default: center) */
      @checkInput([Number,['Pivot','center']], [Number, 'auto'])
      rotateX(deg:number, pivot?:Pivot):AnyShapeCollection
      {
         if (pivot === 'center'){ pivot = this.center();} // use center of ShapeCollection as pivot, not of individual Shape
         this.shapes.forEach( shape => shape.rotateX(deg, pivot));
         return this;
      }

      /** Shape API - Rotate all Shapes around the y-axis with a given angle and given pivot (default: center) */
      @checkInput([Number,['Pivot','center']], [Number, 'auto'])
      rotateY(deg:number, pivot?:Pivot):AnyShapeCollection
      {
         if (pivot === 'center'){ pivot = this.center();} // use center of ShapeCollection as pivot, not of individual Shape
         this.shapes.forEach( shape => shape.rotateY(deg, pivot));
         return this;
      }

      /** Shape API - Rotate all Shapes around the z-axis with a given angle and given pivot (default: center of ShapeCollection) */
      @checkInput([Number,['Pivot','center']], [Number, 'auto'])
      rotateZ(deg:number, pivot?:Pivot):AnyShapeCollection
      {
         if (pivot === 'center'){ pivot = this.center();} // use center of ShapeCollection as pivot, not of individual Shape

         this.shapes.forEach( shape => shape.rotateZ(deg, pivot));
         return this;
      }

      /** Shape API - Rotate all Shapes around a specific axis with a given angle (default: [0,0,1]) and given pivot (default: center) */
      @checkInput([Number,['PointLike',[0,0,1]],['Pivot','center'] ], [Number, 'Vector', 'auto'])
      rotateAround(angle:number, axis?:PointLike, pivot?:Pivot):AnyShapeCollection
      {
         if (pivot === 'center'){ pivot = this.center();} // use center of ShapeCollection as pivot, not of individual Shape
         this.shapes.forEach( shape => shape.rotateAround(angle, axis, pivot));

         return this;
      }

      /** Scale entire ShapeCollection */
      @checkInput([[Number,SHAPE_SCALE_DEFAULT_FACTOR], ['PointLike', null]],[Number,'Point'])
      scale(factor?:number, pivot?:PointLike):AnyShapeCollection
      {
         pivot = pivot || this.center();
         this.shapes.forEach( shape => shape.scale(factor,pivot));
         return this;
      }

      /** Scale entire ShapeCollection and return copy */
      @checkInput([[Number,SHAPE_SCALE_DEFAULT_FACTOR], ['PointLike', null]],[Number,'Point'])
      scaled(factor?:number, pivot?:PointLike):AnyShapeCollection
      {
         let newCollection = this._copy();
         newCollection.scale(factor, pivot);
         return newCollection;
      }

      /** Shape API - Align Shapecollection to other Shape or ShapeCollection */
      @checkInput(['AnyShapeOrCollection',['Pivot','center'],['Alignment', 'center']],['ShapeCollection','auto','auto'])
      align(other:AnyShapeOrCollection, pivot?:Pivot, alignment?:Alignment):AnyShapeOrCollection
      {
         const otherCollection = other as ShapeCollection; // autoconverted
         const others = (otherCollection.count() === 1) ? otherCollection.first() : otherCollection;

         // pivot using bbox() of ShapeCollection
         const pivotAlignPerc:Array<number> = (this.bbox().shape())._alignPerc(pivot)
         const alignmentPerc:Array<number> = (ShapeCollection.isShapeCollection(others)) 
                                                ? (others.bbox().shape())._alignPerc(alignment) 
                                                : (others as Shape)._alignPerc(alignment)
         
         const fromPosition = this.bbox().getPositionAtPerc(pivotAlignPerc).toVector();
         const toPosition = others.bbox().getPositionAtPerc(alignmentPerc).toVector();

         this.move(toPosition.subtracted(fromPosition));

         return this;
      }

      /** Shape API - */
      alignByPoints(...args):AnyShapeCollection
      {
         console.warn('ShapeCollection.alignByPoint: **** TO BE IMPLEMENTED ****');
         return this;
      }

      /** Shape API - */
      alignedByPoints(...args):AnyShapeCollection
      {
         console.warn('ShapeCollection.alignedByPoint: **** TO BE IMPLEMENTED ****');
         return this;
      }

      /** Shape API - */
      rotateVecToVec(...args):AnyShapeCollection
      {
         console.warn('ShapeCollection.rotateVecToVec: **** TO BE IMPLEMENTED ****');
         return this;
      }

      /** Shape API - Make an geometric array by offset ShapeCollection */
      array(size:number|Array<number>, spacings:number|Array<number>):AnyShapeCollection
      {
         let newShapes = new ShapeCollection();
         this.shapes.forEach( shape => {
            newShapes.add( shape.array(size,spacings));
         });

         return newShapes;
      }

      /** Shape API */
      @checkInput([Number,'PointLike'], [Number, 'Point']) 
      _array1D(size:number, spacingOffset:PointLike):AnyShapeCollection
      {
         let newCollection = new ShapeCollection();
         this.shapes.forEach( shape => {
            newCollection.add( shape._array1D(size,spacingOffset));
            // NOTE: array always returns the original Shape too - we get doubles in new ShapeCollection
         });

         return newCollection.unique(); // Remove doubles with unique()
      }


      /** Shape API - Mirror Shapes relative to X-plane (x=0) with its collection center as pivot or given offset x-coord */
      @checkInput([[Number,null]], ['auto'])
      mirrorX(offset?:number):AnyShapeCollection
      {
         offset = offset ?? this.center().y; // based on given offset or center of collection

         this.shapes.forEach( shape => {
            shape.mirrorX(offset);
         })
         return this;
      }

      /** Shape API - Mirror copies of Shapes relative to X-plane (x=0) with its collection center as pivot or given offset x-coord */
      @checkInput([[Number,null]], 'auto')
      _mirroredX(offset?:number)
      {
         const newCollection = new ShapeCollection();
         offset = (offset !== null) ? offset : this.center().y; // based on given offset or center of collection
         this.shapes.forEach(shape => newCollection.add(shape._mirroredX(offset)));
         return newCollection;
      }

      /** Shape API - Mirror copies of Shapes relative to X-plane (x=0) with its collection center as pivot or given offset x-coord */
      @checkInput([[Number,null]], 'auto')
      mirroredX(offset?:number)
      {
         return this._mirroredX(offset);
      }

      /** Shape API - Mirror Shapes relative to Y plane (y=0) with its collection center as pivot or given offset y-coord */
      @checkInput([[Number,null]], 'auto')
      mirrorY(offset?:number):AnyShapeCollection
      {
         offset = offset ?? this.center().x; // based on given offset or center of collection

         this.shapes.forEach( shape => {
            shape.mirrorY(offset);
         })
         return this;
      }

      /** Shape API - Mirror copies of Shapes relative to Y plane (y=0) with its collection center as pivot or given offset y-coord */
      @checkInput([[Number,null]], 'auto')
      _mirroredY(offset?:number)
      {
         const newCollection = new ShapeCollection();
         offset = offset ?? this.center().x // based on given offset or center of collection
         this.shapes.forEach(shape => newCollection.add(shape._mirroredY(offset)));
         return newCollection;
      }

      /** Shape API - Mirror copies of Shapes relative to Y plane (y=0) with its collection center as pivot or given offset y-coord */
      @checkInput([[Number,null]], 'auto')
      mirroredY(offset?:number)
      {
         return this._mirroredY(offset);
      }

      /** Shape API - Mirror Shapes relative to Z plane (z=0) with its collection center as pivot or given offset z-coord */
      @checkInput([[Number,null]], 'auto')
      mirrorZ(offset?:number):AnyShapeCollection
      {
         offset = offset ?? this.center().z; // based on given offset or center of collection
         this.shapes.forEach( shape => {
            shape.mirrorZ(offset);
         })
         return this;
      }

      /** Shape API - Mirror copies of Shapes in Z-plane (z=0) with its collection center as pivot or given offset z-coord */
      @checkInput([[Number,null]], 'auto')
      _mirroredZ(offset?:number)
      {
         const newCollection = new ShapeCollection();
         offset = offset ?? this.center().z; // based on given offset or center of collection
         this.shapes.forEach(shape => newCollection.add(shape._mirroredZ(offset)));
         return newCollection;
      }

      /** Shape API - Mirror copies of Shapes relative to XZ plane with its collection center as pivot or given offset z-coord */
      @checkInput([[Number,null]], 'auto')
      mirroredZ(offset?:number)
      {
         return this._mirroredZ(offset);
      }

      /** Shape API - offset Shapes in Collection */
      @checkInput([[Number,null],[String, null],['PointLike', null]], ['auto', 'auto', 'Vector'])
      offset(amount?:number, type?:string, onPlaneNormal?:PointLike):AnyShapeCollection
      {
         this.shapes.forEach( shape => (shape as Shape).offset(amount, type, onPlaneNormal) )

         return this;
      }


      /** Shape API - Extrude Shapes in ShapeCollection a certain amount in a given direction (default: [0,0,1]) */
      @checkInput([ [Number, SHAPE_EXTRUDE_DEFAULT_AMOUNT], ['PointLike', null ]], [Number, 'auto'])
      extrude(amount?:number, direction?:PointLike):AnyShapeCollection
      {
         this.shapes.forEach( shape => {
            shape.extrude(amount, direction);
         });

         return this;
      }


      @checkInput([Number, [String, 'center']], [Number, String])
      thicken(amount:number,  direction?:string):ShapeCollection
      {
         this.forEach( shape => 
         {
           shape.thicken(amount, direction) 
         })
         return this;
      }


      /* !!!! TODO  SHAPE API !!!!
         
         more operations that make sense:
         - thicken
         - sweep?
         - loft?

      */

      /** Just a simple forwarder fillet */
      fillet(radius:number, at?:any):ShapeCollection
      {
         const SHAPES_FILLET = ['Wire','Face', 'Solid']
         this.forEach( 
            shape => {
               if (SHAPES_FILLET.includes(shape.type))
               {
                  (shape as Wire|Face|Solid)?.fillet(radius, at)
               }
            });
         return this;
      }

      /** Shape API: Copy entire ShapeCollection and its Shapes and return a new one */
      _copy():ShapeCollection
      {
         const newShapeCollection = new ShapeCollection();
         // copy by group - including non-grouped shapes as seperate group (=null)
         this.forEachGroup( (groupName, groupShapes) => 
         {
            const copiedShapes = groupShapes.map(shape => shape._copy())
            newShapeCollection.addGroup(groupName, copiedShapes); 
         })
         newShapeCollection.setName( nextName( 'CopyOf' + this.getName() ));
         newShapeCollection._setFakeArrayKeys();

         return newShapeCollection;
      }

      /** Shape API: Copy entire ShapeCollection and its Shapes and return a new one (add to Scene) */
      // NOTE: this is a deep copy! We use this by default to be in line with Shape API
      copy():ShapeCollection
      {
         const newShapeCollection = this._copy();
         newShapeCollection.addToScene();
         return newShapeCollection;
      }

      /** Make new ShapeCollection without copying the Shapes */
      shallowCopy():ShapeCollection
      {
         return new ShapeCollection(this.shapes);
      }

      clone():ShapeCollection
      {
         return new ShapeCollection(this.shapes.map(s => s.clone()));
      }

      /** Shape API — a getter, matching Shape.type and meshup's SceneNodeShape contract.
       *  NOTE: this was a method in the pre-monorepo sources. Everything now reads it as a
       *  property, so leaving it callable made `isShapeCollection()` compare a function to a
       *  string and always answer false. */
      get type():string
      {
         // TODO: Distinguish between: Mixed and the same geometries (like ShapeCollection, EdgeCollection, VertexCollection etc)
         return 'ShapeCollection';
      }

      /** Shape API */
      isShape():boolean
      {
         return false; // Don't make this return - it turns out it's confusing!
      }

      /** Shape/ShapeCollection API consistency */
      isShapeCollection():boolean
      {
         return this.type == 'ShapeCollection';
      }

      /** meshup's ShapeCollection and scene decorators accept anything answering true here. */
      isShapeClass():boolean
      {
         return true;
      }

      /* Test if a given object is a ShapeCollection */
      static isShapeCollection(obj:any): boolean
      {
         return (!obj) ? false : (obj.type && obj.type == 'ShapeCollection');
      }

      /** Shape API */
      center():Point
      {
         switch (this.count())
         {
            case 0:
               return null;
            case 1:
               return (this.first().bbox()) ? this.first().bbox().center() : null; 
            default:
               return this.bbox().center();
         }
      }

      /** Check if all Shapes in this collection are 2D and on the same plane */
      is2D()
      {
         if(!this.shapes.every(s => s.is2D()))
         {
            return false
         }
         else {
            // check same axis
            const firstShape2DAxisMissing = this.first().bbox().axisMissingIn2D();
            return this.shapes.every(s => s.bbox().axisMissingIn2D() === firstShape2DAxisMissing);
         }
      }

      /* If this ShapeCollection is 3D */
      is3D():boolean
      {
         return this.bbox().is3D()
      }

      /** Shape API - get combined bbox of all Shapes in Collection */
      bbox(withAnnotations:boolean=false):Bbox|null
      {
         if(this.length == 0) return null;

         let combinedBbox = this.first().bbox(withAnnotations);
         this.shapes.forEach((shape,i) => {
            if(i > 0)
            {
               // This does not take in the shapes not tied to shapes
               const bbox = shape.bbox(withAnnotations);
               if(bbox)
               {
                  combinedBbox = combinedBbox.added(bbox);
               }
            }
         })
         
         if(withAnnotations)
         {
            // Add Annotations linked to Collection
            this.getAnnotations().forEach( a => combinedBbox = combinedBbox.added(a.toShape().bbox(false)));
            
            // Extra: enlarge bbox with possible Annotations within or nearby
            /*
            this._brep._annotator.getAnnotationsInBbox(combinedBbox)
                  .forEach( a => combinedBbox = combinedBbox.added(a.toShape().bbox(false)));
            */
         }

         // link this collection to Bbox so it can link annotations
         combinedBbox.setParent(this);
         combinedBbox._fromShape(this); // so bbox().box() etc land in the collection's scene

         return combinedBbox;
      }

      /** Shape API: get combined Shape area */
      area():number
      {
         return this.reduce((agg,s) => agg + s.area(), 0)
      }

      /** Shape API: get combined Shape volume */
      volume():number
      {
         return this.reduce((agg,s) => agg + s.volume(), 0)
      }

      /** Shape API */
      _hashcode():string
      {
         // TODO: We need to have this to be consistent with Shape
         return null;
      }
      

      /** Shape API */
      @checkInput('PointLikeOrAnyShapeOrCollection', 'auto')
      _intersections(others:PointLikeOrAnyShapeOrCollection):ShapeCollection
      {         
         if(this.count() == 0)
         {
            // no Shapes in ShapeCollection
            return this;
         }

         if (isPointLike(others))
         {
            others = new Point(others)._toVertex(); // convert PointLike to Vertex so it is a Shape
         }

         let intersections = new ShapeCollection();
         this.forEach(shape => {
            let curIntersections = shape._intersections(others); // can be one shape of a ShapeCollection
            if (curIntersections)
            {
               intersections.add(curIntersections); // ShapeCollections will be flattened
            }
         })

         return intersections;
      }

      /** Create intersecting Shapes between Shapes in this collection and other Shape or Collection */
      @checkInput('PointLikeOrAnyShapeOrCollection', 'auto')
      intersections(others:PointLikeOrAnyShapeOrCollection):ShapeCollection
      {
         return this._intersections(others)
      }

      /** Get Shapes that intersect with given Shape(s) */
      @checkInput('PointLikeOrAnyShapeOrCollection', 'auto')
      intersecting(other:PointLikeOrAnyShapeOrCollection):ShapeCollection
      {
         let otherShapeOrCollection = isPointLike(other) ? new Point(other)._toVertex() : other; // convert PointLike to Vertex so it is a Shape
         
         let intersectors = new ShapeCollection();
         this.shapes.forEach( shape => 
         {
            if (otherShapeOrCollection._intersections(shape) != null)
            {
               intersectors.add(shape)
            }
         })

         return intersectors;
      }

      /** Alias for intersecting */
      @checkInput('PointLikeOrAnyShapeOrCollection', 'auto')
      intersectors(other:PointLikeOrAnyShapeOrCollection):ShapeCollection
      {
         return this.intersecting(other);
      }

      /** Shape API */
      @checkInput('PointLikeOrAnyShapeOrCollection', 'auto')
      contains(other:PointLikeOrAnyShapeOrCollection):boolean
      {
         return (this.find(shape => shape.contains(other)) != null);
      }

      /** Find Shapes within ShapeCollection that entirely contain given other Shape */
      @checkInput('PointLikeOrAnyShapeOrCollection', 'auto')
      containers(other:PointLikeOrAnyShapeOrCollection):ShapeCollection|AnyShape
      {
         return this.filter(shape => shape.contains(other));
      }

      /** Return nearest Shape within this Collection to other given Shape(s) */
      // TODO: write test
      @checkInput('PointLikeOrAnyShapeOrCollection', 'auto')
      nearest(other:PointLikeOrAnyShapeOrCollection):AnyShape
      {  
         const otherShapes = new ShapeCollection();  
         // convert PointLikes to Vertex
         if (isPointLike(other))
         {
            otherShapes.add(new Point(other as PointLike)._toVertex())
         }
         else {
            otherShapes.add(new ShapeCollection(other));
         }
         
         let nearestShape:AnyShape = null;
         let nearestDistance:number = null;

         this.forEach( colShape => {
            otherShapes.forEach( otherShape => {
               if(!nearestDistance || colShape.distance(otherShape) < nearestDistance)
               {
                  nearestShape = colShape;
                  nearestDistance = colShape.distance(otherShape);
               }
            })
         })

         return nearestShape;
      }
      
      /** Shape API */
      _intersectionsWithEdge()
      {
         // TODO
         return null;
      }

      /** Shape API:  Get alle Edges of Shapes */
      vertices():ShapeCollection
      {
         let allVerts = new ShapeCollection();
         this.shapes.forEach( s => { allVerts = allVerts.concat(s.vertices()) });
         return allVerts;
      }

      /** Shape API: Get alle Edges of Shapes */
      edges():ShapeCollection
      {
         let allEdges = new ShapeCollection();
         this.shapes.forEach( s => { allEdges = allEdges.concat(s.edges()) });
         return allEdges;
      }

      /** Shape API: Get all Wires of Shapes in this Collection */
      wires():ShapeCollection
      {
         let allWires = new ShapeCollection();
         this.shapes.forEach( s => { allWires.concat(s.wires()) });
         return allWires;
      }

      /** Shape API: Get all Faces of Shapes */
      faces():ShapeCollection
      {
         let allFaces = new ShapeCollection();
         this.shapes.forEach( s => { allFaces.concat(s.faces()) });
         return allFaces;
      }
      
      /** Shape API: Get all Shells of Shapes */
      shells():ShapeCollection
      {
         let allShells = new ShapeCollection();
         this.shapes.forEach( s => { allShells.concat(s.shells()) });
         return allShells;
      }

      /** Shape API: Get all Solids of Shapes */
      solids():ShapeCollection
      {
         let allSolids = new ShapeCollection();
         this.shapes.forEach( s => { allSolids.concat(s.solids()) });
         return allSolids;
      }

      /** Return new ShapeCollection with only the visible Shapes.
       *  Named onlyVisible() to match meshup's ShapeCollection, where the plain
       *  name would shadow the 'visible' group shortcut of a projection. */
      onlyVisible():ShapeCollection|AnyShape
      {
         return this.filter(s => s.visible());
      }

      /** Shape API 
       *   IMPORTANT: ShapeCollection.select() should probably be run in the context 
       *       of the collection, not of individual shapes. Improving this can greatly improve
       *       chaining like box().select('E||Z').select('E<<X') - where the last select is in context of collection
      */
      select(selectString:string=null):ShapeCollection
      {
         let selectedShapes = new ShapeCollection();
         this.all().forEach( shape => selectedShapes.concat(new ShapeCollection(shape.select(selectString))))
         return selectedShapes.distinct();
      }


      /**  Array API - Pop last Shape from ShapeCollection*/
      pop():ShapeCollection
      {
         this.shapes.pop();
         return this;
      }

      /** Reverse order of the Shapes */
      reverse()
      {
         this.shapes.reverse();
         return this;
      }
      
      /** Shape API */
      removeFromScene()
      {
         this.shapes.forEach( shape => {
            shape.removeFromScene();
         })
      }

      /** Shape API */
      replaceShape(newShapes:Shape|ShapeCollection)
      {
         this.shapes.forEach( shape => {
            shape.replaceShape(newShapes);
         })
      }

      /** Shape API: Project 3D Shapes on XY plane */
      @checkInput([['PointLike',[0,1,0]], ['Boolean', false]],['Vector', 'auto'])
      _project(planeNormal?:PointLike, all?:boolean):ShapeCollection
      {
         const visibleShapes = new ShapeCollection(this.filter( shape => shape.visible() === true)); // filter can return single Shape
         const ocCompoundShape = visibleShapes.toOcCompound(); // combine all Shapes in ShapeCollection as CompoundShape
         // We are hacking the Shape class a bit here to be able to use Shape._project on CompoundShape
         const tmpShape = new Shape();
         tmpShape._ocShape = ocCompoundShape; 
         return tmpShape._project(planeNormal,all);
      }

      /** Shape API: Public Project 3D Shapes on XY plane and add result to Scene */
      @checkInput([['PointLike',[0,1,0]], ['Boolean', false]],['Vector', 'auto'])
      project(planeNormal?:PointLike, all?:boolean):ShapeCollection
      {
          return this._project(planeNormal, all);
      }

      /** Shape API: Generate elevation from a given side without adding to Scene */
      @checkInput([['Side', 'top'], ['Boolean', false]], ['auto', 'auto'])
      _elevation(side?:Side, all?:boolean):ShapeCollection
      {
         const visibleShapes = new ShapeCollection(this.filter( shape => shape.visible() === true)); // filter can return single Shape
         const ocCompoundShape = visibleShapes.toOcCompound(); // combine all Shapes in ShapeCollection as CompoundShape
         // Again: We are hacking the Shape class a bit here
         const tmpShape = new Shape();
         tmpShape._ocShape = ocCompoundShape; 
         
         return tmpShape._elevation(side, all);
      }
      
      /** Shape API: Generate elevation from a given side and add to Scene */
      @checkInput([['Side', 'top'], ['Boolean', false]], ['auto', 'auto'])
      elevation(side?:Side, all?:boolean):ShapeCollection
      {
         return this._elevation(side, all);
      }

      /** Shape API: Generate isometric view from Side or corner of ViewCube ('frontlefttop') or PointLike coordinate
       *      Does not add to Scene
       *      Use includeHidden=true to output with hidden lines
       */
      _isometry(viewpoint?:string|PointLike, includeHidden:boolean=false):ShapeCollection
      {
         const visibleShapes = new ShapeCollection(this.filter( shape => shape.visible() === true));
         const ocCompoundShape = visibleShapes.toOcCompound(); // combine all Shapes in ShapeCollection as CompoundShape
         // Again: We are hacking the Shape class a bit here
         const tmpShape = new Shape();
         tmpShape._ocShape = ocCompoundShape; 
         return tmpShape._isometry(viewpoint, includeHidden);
      }

      /** Shape API: Generate isometric view from Side or corner of ViewCube ('frontlefttop') or PointLike coordinate
       *     Add to scene
      *      Use includeHidden=true to output with hidden lines
      */
      isometry(viewpoint?:string|PointLike, includeHidden:boolean=false):ShapeCollection
      {
         return this._isometry(viewpoint, includeHidden)
      }

      iso(viewpoint?:string|PointLike, includeHidden:boolean=false):ShapeCollection
      {
         return this.isometry(viewpoint, includeHidden)
      }

      //// ARRAY LIKE API ////

      /** Array API - Alias for ForEach to have compatitibility with Array */
      forEach(func: (value: AnyShape, index: number, arr:Array<any>) => void ): ShapeCollection
      {
         this.shapes.forEach(func);
         return this;
      }
      
      /** Array API - Alias for sort to have compatitibility with Array */
      sort(func: (a: any, b: any) => number ):ShapeCollection
      {
         this.shapes.sort(func); // in place changing
         this._setFakeArrayKeys(); // IMPORTANT: otherwise indices are out of sync
         return this;
      }

      /** Array API - Alias for find to have compatitibility with Array */
      find(func: (value: any, index: number, arr:Array<any>) => any ): any
      {
         return this.shapes.find(func);
      }

      /** Array API - Filter Shapes in this Collection and return a new ShapeCollection or single Shape
       */
      filter(func: (value: any, index: number, arr:Array<any>) => boolean ):ShapeCollection
      {
         return new ShapeCollection(this.shapes.filter(func))
      }

      reduce(func: (prevValue: number, curValue:AnyShape, index:number, arr:Array<AnyShape>) => number, startSum:number):number
      {
         return this.shapes.reduce(func, startSum);
      }

      /** Get Shapes at index. NOTE: We can also use the fake index keys like collection[0] */
      @checkInput(Number.isInteger, 'auto')
      at(index:number)
      {
         return this.shapes[index];
      }

      /** Exclude given Shape from current collection */
      not(shape:AnyShape):ShapeCollection
      {
         return new ShapeCollection(this.filter(s => !s.same(shape)))
      }

      /** Check if ShapeCollection is empty */
      isEmpty():boolean
      {
         return this.length === 0;
      }

      /** Alias for length */
      count():number
      {
         return this?.shapes?.length || 0;
      }

      specific()
      {
         /* To match API of Shape */
         return this.collapse();
      }

      //// SHAPE COMBINATION ALGORITHMS ////

      /** Try to calculate the bounding Wire 
       *   Work in progress
       *    See original code: https://github.com/Open-Cascade-SAS/OCCT/blob/ae1683705ef5c9a7e767c5c873e7d725b04d262f/src/ShapeAnalysis/ShapeAnalysis_FreeBounds.cxx#L89
      */
      boundary():Wire
      {
         /*
         console.log('=========== BOUNDARY ===========');
         console.log(this._oc.TopTools_HSequenceOfShape);
         console.log(this._oc.TopTools);
         console.log(this._oc.TopTools.HSequenceOfShape);
         console.log(this._oc.Handle_TopTools_HSequenceOfShape);
         console.log(new this._oc.TopTools().TopTools_HSequenceOfShape);
         */

         const ocShapeSequence = new this._oc.Handle_TopTools_HSequenceOfShape_1();
         const ocEdges = new this._oc.Handle_TopTools_HSequenceOfShape_1();
         this.edges().forEach( e => ocEdges.Append_1(e._ocShape));

         this._oc.ShapeAnalysis_FreeBounds.ConnectEdgesToWires(
                  ocEdges, 
                  0.1, 
                  false,
                  ocShapeSequence);

         return null;
      }

      //// NAVIGATING SHAPES ////

      /** Get Shapes of given type in ShapeCollection */
      @checkInput('ShapeType', 'auto')
      getShapesByType(type:ShapeType):ShapeCollection
      {
        let shapes = this.shapes.filter( s => s.type == type );
        return new ShapeCollection(shapes); // always return ShapeCollection. Can be empty
        // TODO: make specific ShapeCollection: like VertexCollection?
      }

      @checkInput('ShapeTypes', Array)
      getShapesByTypes(types:Array<ShapeType>):ShapeCollection
      {
        let shapes = this.shapes.filter( s => types.includes(s.type));
        return new ShapeCollection(shapes); // always return ShapeCollection. Can be empty
        // TODO: make specific ShapeCollection: like VertexCollection?
      }

      /** Shape API - Get all subshapes of type from Shapes in Collection */
      @checkInput('ShapeType', 'auto') 
      getSubShapes(type:ShapeType):ShapeCollection
      {
         const TYPE_TO_FUNC = { 'Vertex' : 'vertices', 'Edge' : 'edges', 'Wire' : 'wires', 'Face' : 'faces', 'Shell' : 'shells', 'Solid' : 'solids' }
         return this[TYPE_TO_FUNC[type]]();
      }

      /** Get first Shape of Collection */
      first():AnyShape
      {
         return this.shapes[0];
      }

      /** Get last Shape of Collection */
      last():AnyShape
      {
         return this.shapes[this.shapes.length - 1];
      }

      /** Get all direct children Shapes in this Collection */
      children():Array<AnyShape>
      {
         return this.shapes;
      }

      /** Alias: remove this eventually! */
      all():Array<AnyShape>
      {
         return this.children();
      }

      /** get lowest Shape type */
      lowestType():ShapeType
      {
         const TYPES_ORDERED = ['Solid', 'Shell', 'Face', 'Wire', 'Edge', 'Vertex'];

         let lowestType = null;
         let lowestTypeIndex = -1;
         this.shapes.forEach(s => {
            let i = TYPES_ORDERED.indexOf(s.type);
            if (i > lowestTypeIndex){
               lowestTypeIndex = i;
               lowestType = s.type;
            }
         });

         return lowestType;
      }

      /** check if this Collection has a specific instance of a Geometry */
      @checkInput('AnyShapeOrCollection', 'auto')
      has(s:AnyShapeOrCollection):boolean
      {
         if (Shape.isShape(s))
         {
            // NOTE: we can compare instances of AY Shapes or really underlying OC Shapes
            // return this.shapes.includes(s as AnyShape);
            return (this.shapes.find(shape => shape.same(s as Shape)) != null)
         }
         else {
            // is ShapeCollection
            let collectionShapes = (s as ShapeCollection).all();
            for (let i = 0; i < collectionShapes.length; i++)
            {
               let collShape = collectionShapes[i];
               if (this.shapes.find(shape => shape.same(s as Shape)) != null)
               {
                  return true;
               }
            }
            return false;
         }
      }

      /** Array API */
      includes(s:AnyShapeOrCollection):boolean
      {
         return this.has(s);
      }

      /** Check if this Collection has a Shape of a given type */
      @checkInput('ShapeType', 'auto')
      hasType(type:ShapeType):boolean
      {
         return this.getShapesByType(type).length > 0; 
      }

      /** Array API - Get index of given Shape, if not exists -1 */
      @checkInput('AnyShape', 'auto')
      indexOf(s:Shape):number
      {
         return this.shapes.indexOf(s);
      }

      /** Array API - */
      @checkInput([Number.isInteger, Number.isInteger], [Number, Number])
      slice(start:number,end:number):ShapeCollection
      {
         return new ShapeCollection(this.shapes.slice(start,end));
      }

      /** Get the Shapes in current collection that are also in the other one with the same Geometry */
      @checkInput('AnyShapeOrCollection', 'auto')
      getEquals(others:AnyShapeOrCollection):ShapeCollection
      {  
         let equals = [];

         let othersCollection = (isAnyShape(others)) ? new ShapeCollection(others as Shape) :  others as ShapeCollection;

         this.shapes.forEach( curShape => 
         {
            let equalShape = othersCollection.shapes.find(otherShape => curShape.equals(otherShape as any)); // HACK: use any here to avoid TS errors for now
            if (equalShape){
                  equals.push(curShape)
            }
         });

         return new ShapeCollection(equals);
      }

      /** Get the Shapes that the same, but might be translated 
       *    NOTE: this might not be enough to establish 
       * 
      */
      @checkInput('AnyShapeOrCollection', 'auto')
      getEqualsTranslated(others:AnyShapeOrCollection):ShapeCollection
      {
         let equals = [];

         let othersCollection = (isAnyShape(others)) ? new ShapeCollection(others as Shape) :  others as ShapeCollection;

         this.shapes.forEach( curShape => 
         {
            let equalShape = othersCollection.shapes.find(otherShape => curShape._copy().moveTo(0,0,0).equals(otherShape._copy().moveTo(0,0,0) as any));
            if (equalShape)
            {
                  equals.push(curShape)
            }
         });

         return new ShapeCollection(equals);
      }
      
      /** Combine two ShapeCollections and also try to upgrade Shapes that might be combined into higher order Shapes */
      // TODO: performance looks very slow. Can we improve this?
      @checkInput('AnyShapeCollection', 'auto')
      combine(other:ShapeCollection):ShapeCollection
      {
         if(!(other instanceof ShapeCollection))
         {
            console.error(`ShapeCollection::combine: Please supply other ShapeCollection to combine!`);
            return null;
         }
         else {
            this.concat(other);
            this.upgrade();

            return this;
         }
      }


      /** Try to combine collection of shapes into a higher order ShapeCollection */
      // TODO: What to do with the old Shapes when this collection is updated?
      upgrade():ShapeCollection
      {
         this._connectLinearShapes();
         // TODO: Combine Wires into Faces
         // TODO: Combine Faces into Shells
         // TODO: Combine Shells into Solids

         return this;
      }


      /** Try to combine into higher order Shape of same type of Shapes in Collection */
      upgradeShapesByType():this
      {
         const UPGRADE_SHAPE_TYPES = ['Face','Shell'] as Array<ShapeType>; // TODO: more

         UPGRADE_SHAPE_TYPES.forEach( (curType,i) => {
            const groupedByType = this.getShapesByType(curType);
            if(groupedByType.length)
            {
               // We try to be smart by first grouping Shapes if they touch or not, then try to combine them
               const groupedByTouching = groupedByType.groupTouching();
               groupedByTouching.forEachGroup((name,grouped) => {
                  if(grouped.length > 1)
                  {
                     // Try to combine into higher order Shape
                     let combinedShape;

                     switch(curType)
                     {
                        case 'Face':
                           combinedShape = new Shell().fromFaces(grouped);
                           break;
                        case 'Shell': 
                           combinedShape = new Solid().fromShells(grouped);
                           break;
                        default:
                           console.warn(`ShapeCollection: upgradeShapesByType(): Unknown current type "${curType}". Please check code.`)
                     }

                     // Test result
                     const curUpgradeType = (i < UPGRADE_SHAPE_TYPES.length - 1) ? UPGRADE_SHAPE_TYPES[i+1] : 'Solid';
                     if(combinedShape?.type === curUpgradeType)
                     {
                        // Remove old ones from Collection and add new upgraded
                        this.remove(grouped);
                        this.add(combinedShape);

                        console.info(`ShapeCollection: upgradeShapesByType(): Combined ${grouped.length} Shapes of type ${curType} into higher order Shape of type ${curUpgradeType}"`);
                     }
                  }
               })

            }
         }) 

         return this;
      }

      /** Combine touching Shapes into groups with names like touching{{n=0,1,2}} */
      groupTouching():this
      {
         const touchGroups = [] as Array<ShapeCollection>;
         const shapeTolerance = this._oc.SHAPE_TOLERANCE;

         this.shapes.forEach((curShape,i) => {
            if(i === 0)
            {
               touchGroups.push(new ShapeCollection(curShape));
            }
            else {
               // see if curShape touches any shape in the touchGroups
               let putInGroup = false;
               touchGroups.every( groupColl => 
               {
                  groupColl.forEach( groupShape => 
                  {
                     if(!putInGroup && groupShape.distance(curShape) <= shapeTolerance)
                     {
                        groupColl.add(curShape)
                        putInGroup = true;
                     }
                  })
               })
   
               // cur Shape not in any touching group
               if(!putInGroup)
                  {
                     // Add group 
                     touchGroups.push(new ShapeCollection(curShape))
               }
            }
         })
         
         // Make groups
         touchGroups.forEach( (groupColl,i) => this._defineGroup(`touching${i}`, groupColl))

         return this;
      }

      /** Check downgrade */
      checkDowngrade():ShapeCollection
      {
         this.shapes = this.map( shape => shape.checkDowngrade() ).toArray();

         return this;
      }

      /** Force unique Geometry based on the equals() method ( not hash ) */
      @checkInput([['Number',null]], ['auto'])
      unique(tolerance?:number):ShapeCollection 
      {
         const UNIQUE_TOLERANCE = 0.1; // OC tolerance is 0.001 (see _oc.SHAPE_TOLERANCE)
         tolerance = tolerance || UNIQUE_TOLERANCE;
         // first use distinct to filter out Shapes with same hash
         const shapes = this.distinct();
         const usedShapes = new ShapeCollection(); // list of shapes already matched
         const uniqueShapes = new ShapeCollection(); 

         shapes.forEach( curShape => 
         {
            if (!usedShapes.includes(curShape))
            {
               uniqueShapes.push(curShape);
               // with tolerance!
               const equalShapes = shapes.filter( testShape => curShape.equals(testShape, tolerance) ); // Includes curShape
               usedShapes.add(equalShapes); // remove equals shapes from consideration
            }
         })

         return uniqueShapes;
      }

      /** Remove doubles based on OC hash */
      distinct():ShapeCollection
      {
         let distinctShapesByHash = {};

         this.forEach( shape => 
         {
            let hash = shape._hashcode();
            if (!distinctShapesByHash[hash])
            {
               distinctShapesByHash[hash] = shape;
            }
         })

         this.shapes = Object.values(distinctShapesByHash);
         
         this._setFakeArrayKeys();

         return this;
      }

      /** Try to sew Shapes (like Edges, Wires, Faces, Shells) together to create a Face, Shell, Solid or Compound  */
      _sewed():AnyShapeOrCollection
      {
         // !!!! ShapeUpgrade_UnifySameDomain 
         /* ocDocs:
               - BRepBuilder_Sewing: https://dev.opencascade.org/doc/occt-7.4.0/refman/html/class_b_rep_builder_a_p_i___sewing.html
               - general: https://dev.opencascade.org/doc/overview/html/occt_user_guides__modeling_algos.html#occt_modalg_8
               - ProcessIndicator: https://dev.opencascade.org/doc/occt-7.4.0/refman/html/class_message___progress_indicator.html
               - C++ code: https://github.com/i2e-haw-hamburg/opencascade/blob/master/src/BRepBuilderAPI/BRepBuilderAPI_Sewing.cxx
         */
         let ocSew = new this._oc.BRepBuilderAPI_Sewing(1e-6, true, true, true, false);
         this.shapes.forEach( curShape => ocSew.Add(curShape._ocShape));

         ocSew.Perform( new this._oc.Message_ProgressRange_1());
         let ocSewedShapeOrCompound = ocSew.SewedShape();
         if (!ocSewedShapeOrCompound.IsNull())
         {
            // We can have single Shape or a Compound
            let newOcType = new Shape()._getShapeTypeFromOcShape(ocSewedShapeOrCompound);
            if (newOcType != 'Compound')
            {
               // sewing created one new Shape of one type
               console.info(`ShapeCollection:: sewed: Sewing was succesfull and created one Shape of type '${newOcType}'!`); // TODO: geom
               let sewedShape = new Shape()._fromOcShape(ocSewedShapeOrCompound);
               return sewedShape as AnyShape;
            }
            else {
               // we got a Compound Shape: make a ShapeCollection out of it!
               let newShapeCollection = new Shape()._extractShapesFromOcCompound(ocSewedShapeOrCompound);
               console.info(`ShapeCollection:: sewed: Sewing resulting in more than one Shape. Returned a collection`); // TODO: geom
               return newShapeCollection as ShapeCollection;
            }
         }

         // unchanged Shape or ShapeCollection
         return this;

      }

     /** Combining Linear Shapes (Edges and Wires) into Wires connected by Vertices
     *    For Edges that overlap this does not work ( union could work: TODO )
     *    All other Shapes except Edges are kept in the collection
     *    TODO: Use OC native methods here!
     */
      _connectLinearShapes()
     {
         const edges = this.getShapesByType('Edge'); 
         const wires = this.getShapesByType('Wire')
         const wireEdges = new ShapeCollection();
         wires.forEach( w => 
            {
               wireEdges.concat(w.edges());
            }
         ) 

         let allEdges = edges.concat(wireEdges);

         if (allEdges.length <= 1)
         {
            // no or only one Edge(s) to combine
            console.warn(`ShapeCollection::_connectLinearShape: No linear (Edges,Wires) Shapes to combine! Returned original`);
            return this;
         }

         this.remove(edges);
         this.remove(wires);

         let groupedEdges:Array<Array<Edge>> = new Wire()._groupEdges(edges);
         // add Wires and remaining Edges back to Collection
         groupedEdges.forEach( edgeGroup => 
         {
            if(edgeGroup.length == 1)
            {
               this.add(edgeGroup); // single Edge Wire revert back to Edge
            }
            else {
               // make a Wire from the Edges
               this.add( new Wire().fromEdges(edgeGroup) ); // just add the newly combined Wire
            }
         });

         console.info(`ShapeCollection::_connectLinearShapes: Created ${this.getShapesByType('Wire').length} Wire(s). Remaining ${this.getShapesByType('Edge').length} Edges`);
         
         return this;
      }

      /** Removing Shapes that are contained by others in the Collection  */
      _removeContained():ShapeCollection
      {
         let notContainedShapes = [];
         for(let p = 0; p < this.shapes.length; p++)
         {
            let curShape = this.shapes[p];
            let isContained = false;
            for (let s = 0; s < this.shapes.length; s++)
            {
               let otherShape = this.shapes[s];
               if (curShape != otherShape)
               {
                  if(otherShape.contains(curShape))
                  {
                     isContained = true;
                     break;
                  }
               }
            }
            if (!isContained)
            {
               notContainedShapes.push(curShape);
            }
         }

         // remove Shapes
         this.shapes = notContainedShapes;
         this._setFakeArrayKeys();
         
         return this;
      }

      /** The same as _removeContained but returns a new Collection */ 
      _removedContained()
      { 
         let newColl = this.copy();
         newColl._removeContained();
         return newColl;
      }

      /** Test if the collections are the same */
      @checkInput('AnyShapeOrCollection', 'ShapeCollection')
      equals(other:AnyShapeOrCollection):boolean
      {
         const otherCollection = other as ShapeCollection; // autoconverted
         const others = (otherCollection.count() === 1) ? otherCollection.first() : otherCollection;

         if(!ShapeCollection.isShapeCollection(others))
         {
            console.warn(`ShapeCollection::equals(): Other operant is a Shape. Returned false`)
            return false;
         }

         if (this.count() != others.count())
         {
            return false;
         }
         else 
         {
            return this.every( shape => {
               return new ShapeCollection(other).find(otherShape => otherShape.equals(shape))
            })
         }
      }

      /** Check null or single, and return single value if the case  */
      checkSingle():AnyShape|ShapeCollection
      {
         if(this.shapes.length === 0)
         {
            return null;
         }
         else if (this.shapes.length == 1)
         {
            return this.shapes[0] as AnyShape;
         }
         else {
            return this; 
         }
      }

      /** Collapse ShapeCollection into one Shape if there is only one */
      collapse():AnyShape|ShapeCollection
      {
         if(this.shapes.length == 0)
         {
            return null;
         }
         else {
            return this.checkSingle();
         }
      }

      toArray(): Array<AnyShape>
      {
         return this.shapes;
      }

      //// BOOLEAN OPERATIONS (compatible with Shape API) ////

      /* Private Subtract without adding to scene */
      @checkInput('AnyShapeOrCollection', 'auto')
      _subtracted(other:AnyShapeOrCollection):ShapeCollection
      {
         const newShapes = new ShapeCollection();
         /* When other is ShapeCollection we need to keep track of what Shapes 
            were subtracted by any operant Shape : These will not be part resulting collection
         */
         const subtractedShapes = new ShapeCollection();  
         this.shapes.forEach( shape =>
            {
               if (isAnyShape(other))
               {
                  newShapes.add(shape._subtracted(other));
               }
               else if (ShapeCollection.isShapeCollection(other)) { // iterate Shape collection
                  other.forEach(otherShape =>
                  {
                     if(Shape.isShape(otherShape))
                     {
                        const subtractedShape = shape._subtracted(otherShape);

                        if(!subtractedShape)
                        {
                           // No resulting Shape, just skip
                        }
                        // There was an alteration to a Shape in Collection - either generating a ShapeCollection or a other Shape
                        else if(ShapeCollection.isShapeCollection(subtractedShape) || !shape.equals(subtractedShape as Shape)) // second term will not be evaluated when ShapeCollection
                        {
                           newShapes.add(subtractedShape);
                           subtractedShapes.add(shape); // keep track of it, to exclude it from the results
                        }
                        else {
                           // add original shape (to keep data like names)
                           newShapes.add(shape);
                        }
                     }
                  })
               }
            })

         return new ShapeCollection(newShapes.filter(s => !subtractedShapes.includes(s)));
      }

      /** Subtract Shape or ShapeCollection from current ShapeCollection and return new ShapeCollection */
      @checkInput('AnyShapeOrCollection', 'auto')
      subtracted(other:AnyShapeOrCollection):ShapeCollection
      {
        return this._subtracted(other);
      }

      @checkInput('AnyShapeOrCollection', 'auto')
      subtract(other:AnyShapeOrCollection):ShapeCollection
      {
         this.shapes = this._subtracted(other).toArray();
         return this;
      }

      /** Shape API - Try to union all shapes in Collection (without adding to Scene) */
      @checkInput([['AnyShapeOrCollection',null ],[Boolean, false]], ['auto', 'auto'])
      _unioned(other?:AnyShapeOrCollection, noRecurse?:boolean):ShapeCollection|AnyShape
      {
         // just add the other to collection, and then union
         if(other)
         {
            this.add(other);
         }

         let results = new ShapeCollection();

         this.forEach( (curShape,i) => 
         {
            if (i === 0)
            {
               results.add(curShape);
            }
            else
            {
               // Check if any previous union results can be unioned with curShape
               let didUnion = false;
               results.toArray().every( resultShape => {
                  const unionResult = resultShape._unioned(curShape);
                  if(unionResult)
                  {
                     // there was a union, keep track of mutations
                     results.remove(resultShape); // remove old shape
                     results.add(unionResult) // add new unioned Shape/ShapeCollection
                     didUnion = true;
                     return false; // break loop
                  }
                  return true;
               }) 

               // Shape was not unioned, add to results as is
               if(!didUnion)
               {
                  results.add(curShape._copy());
               }
            }
         })

         // We recurse one level by trying again to union the results
         if(!noRecurse && results.length > 1)
         {
            // To increase chances of succesful union order by volume
            // TODO: introduce a smarter approach
            results.sort((a,b) => b.volume() - a.volume())
            results = new ShapeCollection(results.copy().union());
         }

         return results.checkSingle();
      }


      /** Shape API - Try to union all shapes in Collection 
       *   TODO: test and make more robust for a variety of Shapes in a Collection
      */
      /** Fuse every Shape in this collection into one.
       *
       *  NOTE: this used to call `this.added()`, which never existed on ShapeCollection — the
       *  method threw for as long as it has been here. It now folds the Shapes together with
       *  the boolean union the Shape class provides. */
      union():this
      {
         if(this.shapes.length === 0){ return this }

         let fused:AnyShape = this.shapes[0];
         for(let i = 1; i < this.shapes.length; i++)
         {
            const next = fused._unioned(this.shapes[i]);
            if(next){ fused = ShapeCollection.isShapeCollection(next) ? (next as any).first() : next as AnyShape }
         }

         this.removeFromScene(); // Remove current Shapes
         this.empty();
         this.add(fused); // Add the fused Shape to current collection

         return this;
      }
      

      //// STYLING AND VISIBILITY WITH Obj API ////

      /**  Shape API - Add all shapes in the collection to the Scene */
      addToScene():ShapeCollection
      {
         // For now, flatten collection into existing layer
         // TODO: We could start a new layer to keep collection together
         // this._brep.layer( this._brep.getNextLayerName(this.getName()));
         this.all().forEach(shape => shape.addToScene());
         //this._brep.resetLayers(); // return active layer to scene
         return this;
      }

      color(color:any):this
      {
         this.forEach( shape => shape.color(color));

         return this;
      }

      /** Make all Shapes in this ShapeCollection dashed lines */
      dashed():this
      {
         this.forEach( shape => shape.dashed());
         return this;
      }

      /** Assign lineWidth to all Shapes in collection  */
      @checkInput(Number, 'auto')
      lineWidth(lw:number):this
      {
         this.forEach( shape => shape.lineWidth(lw));
         return this;
      }
      
      /** Shape API - Style all Shapes in Collection */
      setStyle(newStyle:Partial<StyleData>):ShapeCollection
      {
         this.forEach( shape => shape.setStyle(newStyle));
         return this;
      }

      //// MESH-KERNEL API PARITY ////

      /** Fuse the Shapes in this collection into one. Mesh-kernel name for union(). */
      merge():this
      {
         return this.union();
      }

      /** Repeat the whole collection on a 3D grid. Mesh-kernel parity with row(). */
      grid(cx:number=2, cy:number=2, cz:number=1, spacing:number=10):ShapeCollection
      {
         const bb = this.bbox();
         if(!bb){ return this }
         const step = [ bb.width() + spacing, bb.depth() + spacing, bb.height() + spacing ];

         const out = new ShapeCollection();
         for (let z = 0; z < cz; z++){
         for (let y = 0; y < cy; y++){
         for (let x = 0; x < cx; x++)
         {
            const first = (x === 0 && y === 0 && z === 0);
            this.shapes.forEach(sh =>
            {
               const shape = first ? sh : sh.copy(false);
               shape.move(x * step[0], y * step[1], z * step[2]);
               out.add(shape);
            })
         }}}
         return out;
      }

      /** The corner points of every Shape in this collection. */
      points():Array<Point>
      {
         return this.shapes.flatMap(s => (s as any).points?.() ?? []);
      }

      /** Mirror every Shape in this collection in place. Mesh-kernel name (meshup mutates
       *  too); use `.copy().mirror(...)` for a mirrored duplicate. */
      mirror(origin:PointLike, planeNormal:PointLike):this
      {
         this.forEach(shape => shape.mirror(origin, planeNormal));
         return this;
      }

      /** Flatten every Shape in this collection onto the coordinate plane perpendicular to
       *  `axis` (default 'z'), then drop the doubles that creates - both across Shapes (two
       *  identical walls flattened onto the same rectangle) and within them (see
       *  Shape._flattened()). Dropped Shapes are removed from the scene. Mutates this
       *  collection. Mirrors meshup's ShapeCollection.flatten(). */
      @checkInput([['MainAxis','z']], ['auto'])
      flatten(axis?:MainAxis):this
      {
         const results = this.shapes.map(shape => 
         {
            const flat = shape.flatten(axis); // replaces the Shape in the scene
            return (flat ?? shape) as AnyShape;
         });

         const seen = new Set<string>();
         const kept = results.filter(s => 
         {
            const key = (s as any)._flatKey?.() ?? s._id;
            if(seen.has(key)){ return false };
            seen.add(key);
            return true;
         })

         const keptSet = new Set(kept);
         results.forEach(s => { if(!keptSet.has(s)){ s.removeFromScene() }});

         this.shapes = kept;
         this._setFakeArrayKeys();
         return this;
      }

      /** Repeat the whole collection `count` times along `direction`, spaced by `spacing`
       *  between combined bounding boxes. Parity with the mesh kernel's ShapeCollection.row(). */
      row(count:number, spacing:number=10, direction:PointLike='x'):ShapeCollection
      {
         const dirVec = new Vector(direction).normalized();
         const bb = this.bbox();
         if(!bb){ return this }
         const offsetSize = new Vector(bb.width(), bb.depth(), bb.height()).scaled(dirVec).length();

         const out = new ShapeCollection();
         for (let i = 0; i < count; i++)
         {
            const step = dirVec.scaled(i * (offsetSize + spacing));
            this.shapes.forEach(s =>
            {
               const shape = (i === 0) ? s : s.copy(false);
               shape.move(step);
               out.add(shape);
            })
         }
         return out;
      }

      /** Place the whole collection on a given height by its combined bounding box, by
       *  default on the XY plane — the shapes keep their positions relative to each other.
       *  Parity with the mesh kernel's ShapeCollection.place(). */
      place(z:number=0):this
      {
         const bb = this.bbox();
         if(!bb){ return this }
         this.forEach(shape => shape.move(0, 0, z - bb.min().z));
         return this;
      }

      /** NOTE: We don't use set/get here, because it doesnt play well with chaining.
       *  Overloaded like meshup — see Shape.name(). */
      name(n:string):this;
      name():string|undefined;
      name(n?:string):this|string|undefined
      {
         return (n) ? this.setName(n) : this.getName();
      }

      /** Name this collection. Mirrored onto its scene layer node when it has one, so a
       *  named group shows up under that name in the scene graph. */
      setName(newName:string):this
      {
         this._name = newName;
         if(this._layer){ this._layer.name = newName }
         return this;
      }

      getName():string|undefined
      {
         // NOTE: falls back to a placeholder rather than undefined - some algorithms depend on a string
         return (typeof this._name === 'string') ? this._name : 'UnnamedShapeCollection';
      }

      /** Shape API - hide all Shapes in Collection */
      hide():this
      {
         this.forEach( shape => shape.hide());

         return this;
      }

      /** Shape API - show all Shapes in Collection */
      show():this
      {
         this.forEach( shape => shape.show());
         return this;
      }


      /** Layout Shapes on XY plane within a given Layout order */
      @checkInput([ ['String','binpack'], ['Boolean', true], ['LayoutOptions', null]], ['String','auto','auto'])
      layout(order:LayoutOrderType, copy:boolean, options:LayoutOptions):ShapeCollection
      {
         let lastItemPosition:Point = new Point(0,0,0);
         let layoutCollection = new ShapeCollection();

         this.forEach( (shape,index) => 
         {
            let workShape = (copy) ? shape._copy() : shape;
            // autoRotate (default)
            workShape = (options?.autoRotate == undefined || options?.autoRotate) ? workShape.rotateToLayFlat() : workShape;
            // flatten if given as option
            // NOTE: _flattened() can return a ShapeCollection of Faces when a Shape flattens
            // onto more than one outline; it answers the same move/bbox/addToScene API used below.
            workShape = (options?.flatten) ? workShape._flattened() as AnyShape : workShape;

            switch (order)
            {
               case 'line':
                  lastItemPosition = this._placeLine(workShape, lastItemPosition, options?.margin, index);
                  break
               case 'binpack':
                     // do when ShapeCollection is done: see underneath
                     break;
               default:
                  throw new Error(`layout:: Unknown layout order "${order}". Please use: 'line','grid','binpack' or 'nest'`)
            }
            
            workShape.addToScene();
            layoutCollection.add(workShape);
         })

         // actions after ShapeCollection is made
         switch(order)
         {
            case 'line':
               // nothing
               break;
            case 'binpack':
               layoutCollection = layoutCollection.pack(options); // add bin Shapes to layouted collection
               break;
         }

         return layoutCollection;
      }


      _placeLine(shape:AnyShape, prevPosition:Point, margin:number=10, index:number):Point // returns last position
      {
         let workShapeBbox = shape.bbox();
         let offset = prevPosition.moved(workShapeBbox.width()/2);
         shape.moveTo(offset.x, offset.y, shape.center().z);
         
         return prevPosition.moved(workShapeBbox.width() + margin)
      }

      pack(options:LayoutOptions, copy:boolean=true):ShapeCollection
      {
         // TODO: implement without old guillotine-packer
         return null;
         /*
         const DEFAULT_BIN_WIDTH = 1000; // NOTE: still in local model-units (can be anything basically)
         const DEFAULT_BIN_HEIGHT = 1000;
         const DEFAULT_AUTOROTATE = false;
         const DEFAULT_FLATTEN = false;
         const BOX_MARGIN_DEFAULT = 5;
         const BIN_MARGIN = 100; 
         
         const position = new Vertex(0,0,0);
         const binWidth = options?.stockWidth || DEFAULT_BIN_WIDTH;
         const binHeight = options?.stockHeight || DEFAULT_BIN_HEIGHT;

         const autoRotate = options?.autoRotate ?? DEFAULT_AUTOROTATE;
         const flatten = options?.flatten ?? DEFAULT_FLATTEN;
         
         if(autoRotate || flatten){ copy = true };

         const boxMargin = (options?.margin !== undefined) ? options.margin : BOX_MARGIN_DEFAULT;
         const boxes = this.toArray().map( (shape,i) => 
         {
            let s = (copy) ? shape._copy() : shape;
            if(autoRotate) s.rotateToLayFlat(); 
            if(flatten)
            {
               const f = s._flattened(); 
               if(!f)
               { 
                  console.error(`ShapeCollection::pack(): Can not flatten Shape at index ${i} of type ${s.type}`)
               }
            } 
            return this._makeBinPackBox(s, boxMargin, i)
         });


         // place boxes with skewest width-height ratio first
         boxes.sort((a,b) => this._calculateSizeSkewness(b) - this._calculateSizeSkewness(a)); // order boxes from big to small for better fitting
         
         const packResult = packer(
            { 
               binHeight: binHeight,
               binWidth: binWidth,
               items: boxes,
            },
            { 
               kerfSize: boxMargin, 
               allowRotation: true 
            }
         ); // returns Array<Array<PackerResultItem>>

         // now align shapes to all bins
         let numPackedBins = packResult.length;
         let toShapeCollection = (!copy) ? this : new ShapeCollection();

         packResult.every((bin,binIndex) => 
         {  
            // start placing Shapes according to resultItem
            (bin as Array<PackerResultItem>).forEach(resultItem => 
            {
               // NOTE: resultItems xy are left top
               const box = resultItem as PackerResultItem;
               let boxCenter = [box.x + box.width/2 + (binIndex*(binWidth+BIN_MARGIN)+position.x), 
                                 box.y + box.height/2 + position.y];
               
               let workShape = this.at(box.item.shapeIndex);
               if(copy)
               { 
                  let newWorkShape = workShape._copy(); // IMPORTANT: don't add to scene - flattened leaves this copy around
                  newWorkShape = (autoRotate) ? newWorkShape.rotateToLayFlat() : newWorkShape;
                  newWorkShape = (flatten) ? newWorkShape._flattened() : newWorkShape;
                  
                  toShapeCollection.addGroup('cut', newWorkShape);
                  workShape = newWorkShape;
               } // copy shape or move in place
               // check if we need to rotate 90 degrees (NOTE: Shape bbox are original size while Box are with margin!)
               if((Math.round(workShape.bbox().width())) != Math.round(box.width))
               {
                  workShape.rotateZ(90);
               }
               
               workShape.moveTo(boxCenter);
               
            })
            return true; // continue every loop
            
         })

         // Add bins in seperate group
         const binShapes = new ShapeCollection();
         if(options?.drawStock === undefined || options.drawStock === true)
         {
            new Array(numPackedBins).fill(null).forEach( (n, bi) => 
            {
               let binStartX = bi*(binWidth+BIN_MARGIN)+position.x;
               let binStartY = position.y;
               let outline = new Face()
                              .makePlaneBetween([binStartX, binStartY],[binStartX+binWidth, binStartY+binHeight])
                              ._toWire();
               binShapes.add(outline);
            })
            
         }

         // return binpacked Shapes and optionally stock outlines in ShapeCollection
         return (binShapes) ? toShapeCollection.addGroup('bins', binShapes) : toShapeCollection;

         */
      }

      _makeBinPackBox(shape:AnyShape, margin:number=10, index:number):any // TODO: typing
      {
         // IMPORTANT: The shape needs to be on XY plane!
         let workShapeBbox = shape.bbox() // DISABLED: .enlarged(margin) - use packer.kerfSize
         const box = { 
            name: shape.getName(), 
            width: workShapeBbox.width(), 
            height: workShapeBbox.depth(),
         } as PackerItem; 
         box.shapeIndex = index; // IMPORTANT: to keep track of box-Shape link
         return box;
      }

      _calculateSizeSkewness(box:any)
      {
         // higher is more skewness
         let whSkew = box.width/box.height;
         let hwSkew = box.height/box.width;
         return (whSkew > hwSkew) ? whSkew : hwSkew;
      }

      //// ANNOTATIONS ////

      /** Add annotations of this ShapeCollection */
      addAnnotations(a:Annotation|Array<Annotation>):this
      {
        // NOTE: an annotation already linked here is not added again — the two-sided link
        // (DimensionLine.link) and the Annotator both add it. Mirrors meshup.
        const annotations = (Array.isArray(a) ? a : [a])
                              .filter(ann => BaseAnnotation.isAnnotation(ann) )
                              .filter(ann => !this.annotations.includes(ann))
        this.annotations = this.annotations.concat(annotations)
        return this;
      }

      /** Make (semi) automatic dimension lines through the Shapes of this collection at levels (in percentage of total size) along MainAxis within bbox
       *    @param options:DimensionLevelSettings
       *    {
       *       levels: Array< Record<MainAxis,number>
       *       minDistance: number (0-1)
       *    }
       * 
      */
      autoDim(settings?:DimensionLevelSettings, strategy?:AnnotationAutoDimStrategy):ShapeCollection
      {
         // TODO: How to tie annotations to ShapeCollection?
         hostAnnotator(this, 'ShapeCollection::autoDim()').autoDim(this, settings, strategy);

         return this;
      }


      //// OUTPUT DATA ////

      /** Shape API - Turn Edges (Line, Arc, Spline etc) into discreet (straight) edges for use in THREE JS
       *    Flattens all Shapes into one array of edges */
      toMeshShapes(quality?:MeshingQualitySettings):Array<MeshShape>
      {  
         let shapeMeshes:Array<MeshShape> = [];
         this.shapes.forEach( s => 
         {
            const meshShape = s.toMeshShape(quality);
            if (meshShape)
            {
               shapeMeshes.push(meshShape);
            }
         });

         console.info(`ShapeCollection:toMeshShapes: Output ${shapeMeshes.length} meshes of ${this.shapes.length} shapes!`);

         return shapeMeshes;
      }

      /** Output all Shapes in Collection to a single ShapeMeshBuffer */
      toMeshShapeBuffer(quality:MeshingQualitySettings):MeshShapeBuffer
      {         
         let meshShapes = this.toMeshShapes(quality);

         let numShapes = meshShapes.length;
         let numVertices = meshShapes.reduce( (acc,shapeMesh) => acc + shapeMesh.vertices.length, 0 );
         let numEdges = meshShapes.reduce( (acc,shapeMesh) => acc + shapeMesh.edges.length, 0 );
         let numFaces = meshShapes.reduce( (acc,shapeMesh) => acc + shapeMesh.faces.length, 0 );
         let numTriangles = meshShapes.reduce( (acc,shapeMesh) => acc + shapeMesh.faces.reduce( (sum, faceMesh) => sum + faceMesh.numTriangles, 0), 0 );

         let stats:MeshShapeBufferStats = { 
            numShapes: numShapes, 
            numVertices: numVertices,
            numEdges: numEdges,
            numFaces: numFaces,
            numTriangles: numTriangles
         }

         let meshShapeBuffer:MeshShapeBuffer = {
            verticesBuffer: [], // size of NumVertices*3
            verticesInfo: [], // info per Vertex
            edgesBuffer: [], // size of NumEdges*2*3
            lineEdgesInfo: [], // info per Edge
            trianglesVertices: [], // variable
            triangleIndices: [], // num triangles * 3
            trianglesVertexColors: [],
            triangleNormals: [],
            triangleUVs: [],
            trianglesInfo: [], // info per triangle
            stats: stats,
         }

         meshShapes.forEach( (curMeshShape, curMeshShapeIndex) =>
         {
            meshShapeBuffer.verticesBuffer = meshShapeBuffer.verticesBuffer.concat(
               curMeshShape.vertices.reduce( (sum, v) => sum.concat(v.vertices), []));
            
            // Per OC Edge we got sequential Vertices coords: either 6 coords for Line Edge, or a multiple of 3 coords
            // We need to output as coordinate pairs
            curMeshShape.edges.forEach( curShapeEdge => 
            {
               let lineSegmentsCoords = [];

               let numVertices = curShapeEdge.vertices.length/3;
               let coordBuffer = curShapeEdge.vertices;
               let prevVertexCoords = null;

               let lineSegmentIndexStart = meshShapeBuffer.edgesBuffer.length/6;
               let lineSegmentIndexEnd = lineSegmentIndexStart + numVertices-1;

               // Info per LineEdge
               let edgeInfo = { objId: curShapeEdge.objId, shapeId: curShapeEdge.ocId, subShapeType: 'Edge', indexInShape: curShapeEdge.indexInShape, 
                              color: new Color(curMeshShape?.style?.stroke?.color || curMeshShape?.style?.color || '#333333').darken(0.5).toInt(), // darken lines a bit
                              edgeGroupLineSegmentsRange: [lineSegmentIndexStart,lineSegmentIndexEnd ] };

               // for the first line segment
               meshShapeBuffer.lineEdgesInfo.push(edgeInfo as any); // avoid TS warning

               for (let v = 0; v < numVertices; v++)
               {
                  // if more then 2 vertices: start pairing by adding previous coordBuffer first
                  if(v >= 2)
                  {
                     // add a edgeInfo object per line segment (2*3 coords)
                     meshShapeBuffer.lineEdgesInfo.push(edgeInfo as any); // avoid TS warning
                     lineSegmentsCoords = lineSegmentsCoords.concat(prevVertexCoords);
                  }
                  let vertexCoords = [coordBuffer[v*3],coordBuffer[v*3+1], coordBuffer[v*3+2]]; // [x,y,z]
                  lineSegmentsCoords = lineSegmentsCoords.concat(vertexCoords); // add vertex coords
                  prevVertexCoords = vertexCoords;  
               }

               meshShapeBuffer.edgesBuffer = meshShapeBuffer.edgesBuffer.concat(lineSegmentsCoords);
            })

            curMeshShape.faces.forEach( f => 
            {
               let lastVertexIndex = (meshShapeBuffer.trianglesVertices.length == 0 ) ? 0 : (meshShapeBuffer.trianglesVertices.length) / 3 ;
               meshShapeBuffer.trianglesVertices = meshShapeBuffer.trianglesVertices.concat(f.vertices); // triangle vertices buffer
               let newVertexIndices = f.triangleIndices.map(i => i + lastVertexIndex);
               meshShapeBuffer.triangleIndices = meshShapeBuffer.triangleIndices.concat(newVertexIndices);

               let newVertexColors = [];
               for(let v = 0; v < f.vertices.length/3; v++)
               {
                  let shapeColor = curMeshShape?.style?.fill?.color || '#333333'; // TODO: nice defaults
                  let rgba = new Color(shapeColor).toGl();
                  newVertexColors.push(rgba[0],rgba[1],rgba[2]);
               }
               meshShapeBuffer.trianglesVertexColors = meshShapeBuffer.trianglesVertexColors.concat( newVertexColors )
               meshShapeBuffer.triangleNormals = meshShapeBuffer.triangleNormals.concat(f.normals);
               meshShapeBuffer.triangleUVs = meshShapeBuffer.triangleNormals.concat(f.uvCoords);

               let trianglesInfo = [];
               let faceInfo = {  objId: f.objId, 
                                 shapeId: f.ocId,
                                 subShapeType: 'Face', 
                                 indexInShape: f.indexInShape,
                                 color: curMeshShape?.style?.fill?.color,
                                 faceGroupVertexIndices : newVertexIndices,
                                }
               // replicate info for numTriangles per Face
               for(let c = 0; c < f.numTriangles; c++)
               {
                  trianglesInfo.push(faceInfo);
               }

               meshShapeBuffer.trianglesInfo = meshShapeBuffer.trianglesInfo.concat(trianglesInfo);
            })

          
            // Info per entity
            meshShapeBuffer.verticesInfo = meshShapeBuffer.verticesInfo.concat( 
                  curMeshShape.vertices.map( 
                     (v) => ({ 
                        objId: v.objId, 
                        shapeId: v.ocId, 
                        subShapeType: 'Vertex', 
                        indexInShape: v.indexInShape, 
                        color: new Color(curMeshShape?.style?.stroke?.color || curMeshShape?.style?.color || '#333333').darken(0.5).toInt()  })) as any // Get rid of TS error. TODO: Look into it!
            );

         })

         // set line stats
         meshShapeBuffer.stats.numLines = meshShapeBuffer.edgesBuffer.length / 6;

         return meshShapeBuffer;
      }  

      toData():Array<Object> // TS typing
      {
         return this.shapes.map(shape => shape.toData());
      }

      toString():string
      {
         return `ShapeCollection<${(this.shapes.length > 0 ? this.shapes.map(s => s.toString()) : 'empty')}>`;
      }



      //// UTILS ////

      /** Get all edges of 2D XY Shapes in this collection 
       *    Supply true to force all Shapes, even invisible ones!
      */
      _get2DXYShapeEdges(all:boolean=false):ShapeCollection
      {
         const shapeEdges = new ShapeCollection();

         this.forEach(shape => 
         {
            if (shape.is2DXY() && (all || shape.visible()))
            {
               shapeEdges.add(shape.edges()); // NOTE: this._parent refers to main Shape of subshapes
            }
         });
         return shapeEdges;
      }

      /** Get Annotations tied to the collection or sub Shapes
       *
       *  NOTE: deduped. An annotation links itself to the Shape it measures AND is added to
       *  the collection that was dimensioned (see Annotator.autoDimPart), so the same object
       *  is in both lists — concatenating them drew every dimension twice, exactly on top of
       *  itself. Mirrors meshup's ShapeCollection.getAnnotations().
       *
       *  @param onlyVisibleShapes skip annotations of Shapes that are hidden
       */
      getAnnotations(onlyVisibleShapes:boolean=false):Array<Annotation>
      {
         const shapeAnnotations = this.shapes.reduce((agg,s) =>
         {
               return (onlyVisibleShapes && !s.visible()) ? agg : agg.concat(s.annotations)
         },[]);

         return [...new Set([...this.annotations, ...shapeAnnotations])];
      }

      /** Export Shapes that are 2D and on XY plane to SVG
       *
       *  The document itself — framing, stylesheet, line weight, annotations — is assembled
       *  in core (see modeler/svgLayers.ts), by the same code the mesh kernel goes through.
       *  This kernel only contributes its line-work. It used to write the whole document
       *  here, byte-duplicating meshup's stylesheet and re-deriving the same margins, which
       *  is how the two came to disagree about what a drawing's extents even are.
       *
       *  @param options { all:boolean, annotations:boolean, unitsPerMm:number }
      */
      toSVG(options?:toSVGOptions):string
      {
         return renderDrawing(this, {
            all: options?.all === true,
            annotations: options?.annotations !== false,
            unitsPerMm: options?.unitsPerMm,
            units: hostUnits(this),
         });
      }


      toDXF(options:toDXFOptions = {}):string|null
      {
         console.warn(`ShapeCollection::toDXF(): DXF export is currently disabled, as we are re-evaluating the best approach for this. Please reach out if you want to use or contribute to this feature!`);
         return null;

         /*
         const UNITS_TO_DXF_UNITS = {
            mm: Units.Millimeters,
            cm: Units.Centimeters,
            dm: Units.Decimeters,
            m: Units.Meters,
            in: Units.Inches,
            ft: Units.Feet,
            yd: Units.Yards,
            mi: Units.Miles,
         } as Record<ModelUnits, any>;

         const DEFAULT_OPTIONS = { all: false, annotations: true };
         options = { ...DEFAULT_OPTIONS, ...(options ?? {}) };
         const shapeEdges = this._get2DXYShapeEdges(options?.all);
         if (shapeEdges.length == 0)
         { 
            console.warn(`ShapeCollection::toDXF(): No 2D Shapes on XY plane found in collection!`);
            return null;
         }

         const writer = new DxfWriter();
         writer.setUnits(UNITS_TO_DXF_UNITS[hostUnits(this) as ModelUnits] || Units.Unitless);
         const modelSpace = writer.document.modelSpace;

         shapeEdges.forEach( edge => {
               (edge as Edge).toDXF(modelSpace); // add Edge as line to DXF modelspace
         });

         if(options?.annotations)
         {
            this.getAnnotations().forEach( a => {
               if(a._type === 'dimensionLine')
               {
                   (a as DimensionLine).toDXF(modelSpace);
               }
            });
         }

         return writer.stringify();
         */
      }

      /** Export this ShapeCollection as a GLB binary — see Shape.toGLTF() for the route. */
      async toGLTF(_options?:ExportGLTFOptions): Promise<ArrayBuffer>
      {
         const { brepShapeToMeshup } = await import('./toMeshup');
         const { SceneNode } = await import('@archiyou/meshup');

         const root = SceneNode.root('scene');
         this.shapes.forEach(s =>
         {
            const exported = brepShapeToMeshup(s as any);
            if(exported){ root.add(exported as any) }
         });

         return await root.toGLB() as unknown as ArrayBuffer;
      }

      /** Convenience method for saving files in browser and node */
      async save(filename?:string, options:any={}, shapes:ShapeCollection|null=null): Promise<string|undefined>
      {
         const shapesToSave = ShapeCollection.isShapeCollection(shapes) ? shapes : this;

         return await new Exporter({} as ArchiyouApp)
            .save(filename, options, shapesToSave);
      }


 }


 