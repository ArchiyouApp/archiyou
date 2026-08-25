// tomy
// A experimental stool made of 4 variable rectangular beams inspired by stereotomy

$PARAMS.define('HEIGHT', 'number', { label: "Height", units: "mm", order: 0, default: 600, minimum: 300, maximum: 1200, multipleOf: 1 });
$PARAMS.define('BEAM_WIDTH', 'number', { label: "Beam size", units: "mm", order: 0, default: 100, minimum: 40, maximum: 150, multipleOf: 1 });
$PARAMS.define('LEG_OFFSET', 'number', { label: "Leg offset", units: "mm", order: 0, default: 60, minimum: 20, maximum: 180, multipleOf: 1 });

// Archiyou 0.6.3
/* !!!! CURRENTLY ONLY FOR BEAM_WIDTH = BEAM_THICKNESS
    otherwise legs are not the same!
    TODO: touch cuts in iso
*/

HEIGHT =  $HEIGHT;
BEAM_WIDTH = $BEAM_WIDTH;
BEAM_THICKNESS = BEAM_WIDTH;  // only rectangular beam sections 

LEGS_DIAGONAL_OFFSET =  $LEG_OFFSET; // offset along 45 diagonal


//// MODEL ////

legTopPlane = rect(BEAM_WIDTH,BEAM_THICKNESS)
    .move(-BEAM_WIDTH/2,-BEAM_THICKNESS/2)
    .moveZ(HEIGHT)

layer('legs').color('green');

legBottomPlane = legTopPlane
                    .copy().move(-LEGS_DIAGONAL_OFFSET, -LEGS_DIAGONAL_OFFSET)
                    .moveToZ(0)

leg = legBottomPlane.loft(legTopPlane.hide())

legOrig = leg.copy().hide();

// Leg touch cutoff 
legVec = legTopPlane.center().toVector().subtract(legBottomPlane.center()).setY(0);
legAngleXZ = legVec.angle([0,0,1]) // angle from Z-axis
legTopSize = BEAM_WIDTH / Math.cos(toRad(legAngleXZ));
// We make the beams touch the amount that remains of the top after cutting
// legTouchSize = legTopSize - legTouchCutOffset
legTouchSize = legTopSize / (1+Math.tan(toRad(legAngleXZ)));
legTouchCutOffset = Math.tan(toRad(legAngleXZ))*legTouchSize;

leg.move(legTouchCutOffset,legTouchCutOffset)
    .cutoff('x', 0)
    .cutoff('y', 0)

// Other 3 legs
legFrontRight = leg.copy().mirrorY(0);
legBackRight = legFrontRight.copy().mirrorX(0);
legBackLeft = leg.copy().mirrorX(0);

model = all();


// Final flat leg
legCutFrontFace = leg.faces()
.filter( f => f.normal().angle([0,-1,0]) < 40 ) // get front leg  face
.sort((f1,f2) => f1.normal().angle([0,-1,0]) - f2.normal().angle([0,-1,0])) // a bit more robust
.first().toMesh().move(1000)

legCutFrontFace.layflat().moveToZ(0); // was rotateVecToVec(normal,[0,0,1])
legCutFrontFace.move(-legCutFrontFace.bbox().width()-100).moveToY(0)
//legCutFrontFace.autoDim();
//legCutFrontFace.hide();


layer('cuts');


// Flat leg
// TODO: make sense of all lay methods
flatLeg = legOrig.copy()
    .moveToZ(0)
    .moveToY(0)
    .move(1000)


flatLegFacesByArea = flatLeg.faces().sort((a,b) => b.area() - a.area()); // .first().copy().color('blue')
largestArea = flatLegFacesByArea.first().area();
flatLegFacesByAreaLargest = flatLegFacesByArea.filter( f => Math.round(f.area()) === Math.round(largestArea) )
                                .sort((a,b) => Math.abs(b.normal().y) - Math.abs(a.normal().y) )
flatFace = flatLegFacesByAreaLargest.first();
flatLeg.rotateQuaternion(flatFace.normal().rotationBetween([0,1,0])).rotateX(-90); // was rotateVecToVec()


// TODO: fix obbox().box() etc
// Rotate so length of obbox aligns to y axis
obbox = flatLeg.obbox();
// meshup OBbox axes are principal axes sorted by variance: axes()[0] is the longest
legLength = obbox.length();
lengthVec = obbox.axes()[0];

flatLeg.rotateQuaternion(vector(lengthVec).rotationBetween([0,1,0])); // was rotateVecToVec()
flatLeg.moveZ(-flatLeg.bbox().height()/2); // TMP: not on XY, but underneath for layFlatTop to be shown

//     When beam is flat - local axis is x, y is feed direction of saw
//     primary cut angle is [-45,45] where x-axis gives +- ~ this corresponds to axis of saw base 
layFlatFaceTop = flatLeg.select('F||top').copy().color('blue');
layFlatFaceTop.hide();

cutBackPlane = flatLeg.select('F||back').copy().color('purple');
cutBackPrimaryLine = layFlatFaceTop.select('E||back').copy().color('red').hide();
cutBackPrimaryLineDirection = cutBackPrimaryLine.direction().normalize(); // physical cut direction (- local x)
if(cutBackPrimaryLineDirection.x < 0) cutBackPrimaryLineDirection.reverse();

cutBackPrimaryAngle = -roundTo(cutBackPrimaryLineDirection.angleRef([1,0,0], [1,0,0]),1);
cutBackSecondaryAngle = roundTo(cutBackPlane.normal()
                        .angleRef(cutBackPrimaryLineDirection.copy().rotateZ(90)
                            , [0,1,0]),1);

// Check direction of secondary cut
if(cutBackPlane.normal().z < 0)
{
    // Saw can only cut at secondary angle in direction of local beam y
    // Flip beam
    pivot = flatLeg.center().copy();
    flatLeg.rotateY(180); // TODO: Add rotation pivot
    //print(layFlatFaceTop)
    layFlatFaceTop.rotateY(180, pivot);
    cutBackPlane.rotateY(180, pivot);
    cutBackPrimaryLine.rotateY(180, pivot);
    // flip primary cut angle
    cutBackPrimaryAngle *= -1;
    // Because secondary cut angle is always [0,45] we don't change that
}

//layFlatFaceTop.autoDim(); // Needs to move to Z=0 otherwise is not shown. Do in Doc pipeline

// for presentation make first beam only cut at back side
frontCutFace = flatLeg.select('F||front').copy();
frontCutRect = rect(frontCutFace.bbox().width(), frontCutFace.bbox().height())
frontCutFaceLoft = frontCutFace.copy().loft(
    frontCutRect
    .rotateX(90)
    .align(frontCutFace, 'toprightfront', 'toprightfront'))


// Don't show any fab model parts
legFabBaseCuts = layer('cuts').shapes().hide();
legFabFaces = collection(layFlatFaceTop, legCutFrontFace).hide();


//// METRICS

calc.metric('top width', Math.round((legTopPlane.bbox().width()-legTouchCutOffset)*2), { 'unit': 'mm'});
calc.metric('top depth', Math.round((legTopPlane.bbox().depth()-legTouchCutOffset)*2), { 'unit': 'mm'});

//// DOCS

docPipeline = () => {


    layer('doc')
    iso = model.iso();


    legFabBaseCuts.show();
    legFabFaces.show();

    cutIso = layer('cuts').shapes().iso([1,-1,1], true)
                .rotateZ(-120)
                .move(3000)

    // combine total flat leg with cut leg
    // layFlatFaceTop.autoDim(); // Needs to move to Z=0 otherwise is not shown. TODO: Fix in DOC
    // Do dimensioning for docs
    
    //legCutFrontFace.show();
    legCutFrontFace.autoDim();
    //layFlatFaceTop.show();
    layFlatFaceTop.autoDim();

    
    //layer('cuts').shapes().show();
    //print(layer('cuts').shapes().toSvg());
    

}

//docPipeline();


doc.page('spec')
    .titleblock({ title: 'Tomy', designer: 'Archiyou' })
    .pipeline(docPipeline)
    .view('iso')
    .shapes('iso')
    .width(0.23)
    .height(0.8)
    .pivot(0,0)
    .position(0,0)
    .view('legFabFaces')
    .shapes('legFabFaces', true) 
    .height(1)
    .width(0.4)
    .pivot(0,1)
    .position(0.25, 1)
    .view('cutIso')
    .shapes('cutIso')
    .width(0.3)
    .height(0.8)
    .pivot(0,0)
    .position(0.7,0.1)
    // NOTE: Line breaks not working in browser (they do in PDF)
    // NOTE for rectangular offsets cutBackPrimaryAngle = cutBackPrimaryAngle
    // - to avoid confusion with rounding errors have them the same
    .textarea(`You can cut all legs from one beam without changing saw angles.
    Lay beam like in isometry on your miter saw.
    Set saw angles: 
        - Primary angle=${cutBackPrimaryAngle}
        - Secondary angle=${Math.abs(cutBackPrimaryAngle)} (cut in feeddirection)
    Start first cut at end of the beam
    Then make legs by marking lengths 
    and feed the beam through the saw 
    without changing the orientation of beam
    afterwards you can cut the orthogonal cuts where the beams touch`,
            { size: '3.5mm'})
    .width(0.3)
    .position(0.7, 0.57)
    .image('https://cms.shopxyz.nl/uploads/miter_saw_cuts_4699470291.svg')
    .width(0.2)
    .height(0.2)
    .pivot(0,1)
    .position(0.65,1)
    .text('Parts', { size: '5mm'})
    .pivot(0,0)
    .position(0,0.07)
    .textarea(`You need 4 beams of around ${Math.round(legLength*1.05)}mm.
    That's total length of ${Math.round(legLength*1.05*4)}mm`, { size: '3mm'})
    .width(0.25)
    .height(0.07)
    .pivot(0,0)
    .position(0,0)

    
    


    

