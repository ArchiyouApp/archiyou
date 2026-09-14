// maritavolo
// The classical table of Enzo Mari

$PARAMS.define('DEPTH', 'number', { label: "Depth", units: "cm", order: 0, default: 80, minimum: 40, maximum: 120, multipleOf: 1 });
$PARAMS.define('LENGTH', 'number', { label: "Length", units: "cm", order: 0, default: 200, minimum: 150, maximum: 220, multipleOf: 1 });
$PARAMS.define('HEIGHT', 'number', { label: "Height", units: "cm", order: 0, default: 70, minimum: 50, maximum: 120, multipleOf: 1 });
$PARAMS.define('BEAM_WIDTH', 'number', { label: "Beam Width", units: "mm", order: 0, default: 50, minimum: 40, maximum: 80, multipleOf: 1 });
$PARAMS.define('BEAM_THICKNESS', 'number', { label: "Beam Thickness", units: "mm", order: 0, default: 25, minimum: 15, maximum: 40, multipleOf: 1 });

// Archiyou 0.15
units('mm');


TABLE_HEIGHT = $HEIGHT*10;
TABLE_WIDTH = $DEPTH*10; // from cm to mm
TABLE_DEPTH = $LENGTH*10; // from front view - is table length
TABLE_OVERHANG = 350;

STRUT_HEIGHT = $BEAM_THICKNESS;
STRUT_WIDTH = $BEAM_WIDTH;

//// CALCULATED PARAMS ////

spineHeight = TABLE_HEIGHT/2 - STRUT_WIDTH;
spineWidth = TABLE_DEPTH - TABLE_OVERHANG*2;

//// 

layer('sides').color('red');

sidePostLeft = boxbetween([0,0,0],[STRUT_WIDTH,STRUT_HEIGHT,TABLE_HEIGHT]).name('sideV');
sideHorMid = boxbetween([0,0,0], [TABLE_WIDTH, STRUT_HEIGHT, STRUT_WIDTH])
                .move(0,-STRUT_HEIGHT, TABLE_HEIGHT/2-STRUT_WIDTH) // horizontal is aligned from top to middle of height
                .name('sideH');

sideHorMidIn = sideHorMid.copy().move(0, STRUT_HEIGHT*2).name('sideH')

sideHorTop = sideHorMid.copy().move(0,0,TABLE_HEIGHT/2).name('sideH')
sideHorTopIn = sideHorMidIn.copy().move(0,0,TABLE_HEIGHT/2).name('sideH');

sideCenterLine = line(
                    [TABLE_WIDTH/2],
                    [TABLE_WIDTH/2, 0, TABLE_HEIGHT]
                    ).hide();
sidePostRight = sidePostLeft.copy().mirrorX(sideCenterLine.center().x).name('sideV');

layer('diagonalLeft').color('purple')

diagLineStart = sideHorMid.select('V||leftbackbottom')
                    .copy().move(STRUT_WIDTH*2)
                    .color('blue')

diagLineEnd = sideCenterLine.end()
                .copy().move(-STRUT_WIDTH*2,0,-STRUT_WIDTH)
                .color('blue')
diagLine = line(diagLineStart,diagLineEnd)
diagLineVec = diagLineEnd.toVector().subtract(diagLineStart);
diagLineWidthVec = vector(diagLineVec).rotate([0,1,0], -90) // rotated() would mutate diagLineVec
diagStrutVertexLeftBottom = diagLineStart 
                            .copy().move(diagLineWidthVec.normalize().scale(STRUT_WIDTH))
                            .color('yellow')
                            .hide();
diagStrutTestLine = line(
                        diagStrutVertexLeftBottom, 
                        diagStrutVertexLeftBottom.copy().move(diagLineVec.normalized().scale(1000)).hide()
                    ).hide();


diagStrutLineLeftEnd = diagStrutTestLine.intersection(sideHorTop.select('E||topback')).hide(); // two open Curves cross in a Vertex

diagStrutLeft = line(diagStrutVertexLeftBottom, diagStrutLineLeftEnd)
                .extrude(STRUT_WIDTH, diagLineWidthVec.reversed())
                .extrude(STRUT_HEIGHT, [0,1,0])
                .name('sideD');

diagStrutLeft.copy().mirrorX(sideCenterLine.center().x)
            .name('sideD')

sideFront = all().onlyVisible().color('red').name('sideFront');
sideBack =  sideFront
            .copy()
            .move(0,spineWidth+STRUT_HEIGHT)
            .name('sideBack')
            .color('red');

//// SPINE ////
/* 
    NOTE: spine is first positioned on flat XY plane 
*/

layer('spine').color('green');

trussesInsideRect = rectbetween(
    [0,0,0], [spineWidth, spineHeight-STRUT_HEIGHT] // slightly lower due to montage rotat
    ).hide();

verticalStrutsMid = collection();
trussInsideSegmentsArr = collection();

new Array(4).fill(null)
                        .forEach( (v,i, arr) => {
                            const segmSize = trussesInsideRect.bbox().width()/4;
                            sx1 = i*segmSize + ((i > 0) ? STRUT_HEIGHT : 0);
                            sx2 = sx1+segmSize - ((i > 0) ? STRUT_HEIGHT : 0) 

                            trussInsideSegmentsArr.add(
                                rectbetween(
                                [sx1, 0],
                                [sx2, trussesInsideRect.bbox().depth()])
                                .hide()
                            )

                            if (i < arr.length - 1 )
                            {
                                verticalStrutsMid.add(
                                    boxbetween(
                                    [sx2, 0,0],
                                    [sx2+STRUT_HEIGHT, trussesInsideRect.bbox().depth(), STRUT_WIDTH])
                                )
                            }
                            
                        });


verticalStrutsMid.forEach(s => s.name('strut V mid'))

diagonalStruts = trussInsideSegmentsArr.map( (segmRect,i) => 
{    
    d = make.fitRectStrut(
        STRUT_HEIGHT,
        [segmRect.bbox().width(), segmRect.bbox().depth()]
        ).moveTo(segmRect.center())

    if(i % 2 == 1)
    {
        // mirrored(planePoint, planeNormal) => copy().mirror(planeNormal, planePoint)
        d = d.hide().copy().mirror([1,0,0], d.center());
    }
    d.hide();
    return d;
})
diagonalStruts = diagonalStruts.extrude(STRUT_WIDTH, [0,0,1])
diagonalStruts.forEach((s,i) => s.name(`strutD`))

spineStrutLeft = boxbetween([-STRUT_HEIGHT,-STRUT_WIDTH, 0],
                            [0,spineHeight+STRUT_WIDTH,STRUT_WIDTH]
                            ).name('strutV ends')

spineStrutRight = spineStrutLeft.copy().mirrorX(spineWidth/2).name('strutV ends')

spineHorFrontTop = boxbetween(
                        [-STRUT_HEIGHT*2,0, STRUT_WIDTH],
                        [spineWidth+STRUT_WIDTH,STRUT_WIDTH, STRUT_WIDTH+STRUT_HEIGHT])
                        .name('strutH');

spineHorFrontBottom = spineHorFrontTop.copy().mirrorZ(STRUT_WIDTH/2).name('strutH')
spineHorBackTop = spineHorFrontTop.copy().mirrorY(spineHeight/2).moveY(-STRUT_HEIGHT)
                        .name('strutH')
spineHorBackBottom = spineHorBackTop.copy().mirrorZ(STRUT_WIDTH/2)
                        .name('strutH')
// cleanup and group spine

spine = collection(verticalStrutsMid, 
                diagonalStruts,
                spineStrutLeft,
                spineStrutRight,
                spineHorFrontTop,
                spineHorFrontBottom,
                spineHorBackTop,
                spineHorBackBottom);

spine.rotateX(90).rotateZ(90);

spine.align(sideFront, 'topfrontcenter', 'topfrontcenter')
        .name('spine')



//// TABLE TOP ////

layer('tabletop').color('brown');
topNumPlanks = Math.round(TABLE_WIDTH/STRUT_WIDTH);
topPlank = box(STRUT_WIDTH, TABLE_DEPTH, STRUT_HEIGHT);
topPlanks = topPlank.array([topNumPlanks,1,1],[topPlank.bbox().width(),0,0])
topPlanks.align(spine, 'bottomcenter', 'topcenter').name('top')

//// COMBINE MODEL /////
table = collection(sideFront, sideBack, spine, topPlanks);


//// DATA ////

parts = make.partList(collection(spine,sideFront), 'parts');

//// DOC PIPELINE ////

function docPipeline()
{
    table.getGroup('top').moveZ(700)
    iso = table.iso().move(8000)
    table.getGroup('top').moveZ(-700); // move back
   

    // Spine elevation and dimensioning
    spineElevation = spine.elevation('left', true); //.move(8000, -2000);

    spineElevation.autoDim({ levels: [
        { axis: 'y', at: -spineHeight/2, minDistance : 1  },
        { axis: 'x', at: spineWidth/2 + STRUT_HEIGHT*0.5, minDistance : 1, showLine:true },
    ]})
    spineElevation.bbox().back().dim();
    spineElevation.bbox().left().dim();

    // Side elevation and dimensioning
    sideElevation = sideBack.elevation('front', true).move(5000, -2000);
    sideElevation.autoDim({
        levels: [
            { axis: 'x', at: 0.01, minDistance: 1, offset: 50 },
            { axis: 'y', at: 1.0, minDistance: 1, offset: 100 },
        ]
    })
    sideElevation.bbox().front().dim({ offset: 50 });
    sideElevation.bbox().right().dim({ offset: 50 });
}

//docPipeline(); // UNCOMMENT TO DEBUG


plan =  doc.create('plan')
            .page('plan')
            .pipeline(docPipeline)
            .titleblock({ title: 'Tavolo', designer: 'Enzo Mari', designLicense: 'CC-BY-NC', manualLicence: 'CC-BY-NC' })
            .text('Tavolo Rettangolare', { size: '10mm' })
            .position(0,1.0)
            .text(`${$LENGTH}x${$DEPTH} H${$HEIGHT} ${STRUT_HEIGHT}x${STRUT_WIDTH}`, { size: '6mm' })
            .position(0,0.93)
            .view('iso')
            .shapes('iso')
            .pivot('topleft')
            .position(0,0.8)
            .width(0.55)
            .height(0.75)
            .view('spineElevation')
            .shapes('spineElevation')
            .pivot('topright')
            .position(1.0,1)
            .width(0.6)
            .height(0.3)
            .table('parts', { fontsize: 7 })
            .position(0.45,0.32)
            .width(0.32)
            .text('Cut list', { size: '6mm' })
            .position(0.45, 0.39)
            .view('side')
            .shapes('sideElevation')
            .pivot('bottomright')
            .position(1,0.3)
            .width(0.2)
            .height(0.3)
            
            
