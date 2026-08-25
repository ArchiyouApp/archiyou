// slidercabinet
// Sliding door cabinet – regression test for spade CDT T-intersection panic during layflat


// Sliding door cabinet with layflat – faithfully reproduces the user's script structure.
// The combination of kerf-notch panels and door slider-rail subtractions creates
// polygon faces whose 2D projections contain T-intersections (a vertex lying on a
// non-adjacent edge). These caused spade's bulk_load_cdt to panic with
// "Conflicting edge encountered: [4, 3]".

$PARAMS.define('WIDTH',            'number', { label: "Width",            units: "mm", default: 900, minimum: 400, maximum: 2000, multipleOf: 1 });
$PARAMS.define('HEIGHT',           'number', { label: "Height",           units: "mm", default: 800, minimum: 300, maximum: 2400, multipleOf: 1 });
$PARAMS.define('DIVIDERS',         'number', { label: "Vertical dividers",             default: 2,   minimum: 0,   maximum: 5,    multipleOf: 1 });
$PARAMS.define('SLIDER_DOOR_OPEN', 'number', { label: "Slider door open %",           default: 0,   minimum: 0,   maximum: 100,  multipleOf: 1 });

BOARD_THICKNESS = 18;
WIDTH = $WIDTH;
HEIGHT = $HEIGHT;
DEPTH = 400;
BACKPLATE = true;

DIVIDERS_VERTICAL = $DIVIDERS;
SHELVES = 0;
FRONT_SLIDER_DOORS = true;

//// FUNCTIONS ////
function panel(length, depth, orientation, flip, slits)
{
  const basePanel = box(length, depth, BOARD_THICKNESS);
  kerfSub = box(BOARD_THICKNESS/2, depth, BOARD_THICKNESS/2).hide();

  if(orientation === 'vertical')
  {
    basePanel.rotateY(90).place(0)
    kerfSub = box(BOARD_THICKNESS/2, depth, BOARD_THICKNESS/2).hide();
    basePanel.subtract(
      kerfSub.copy()
      .align(basePanel, 'leftfrontbottom', 'leftfrontbottom')
      .removeFromScene()
    ).subtract(
      kerfSub.copy()
         .align(basePanel, 'leftfronttop', 'leftfronttop')
        .removeFromScene()
    );
  }

  if(orientation === 'horizontal')
  {
     basePanel.move(length/2-BOARD_THICKNESS/2);
     basePanel.subtract(
       kerfLeft = kerfSub.copy()
        .align(basePanel, 'leftfrontbottom', 'leftfrontbottom')
       .move(BOARD_THICKNESS/2, 0, BOARD_THICKNESS/2)
      );

    basePanel.subtract(
      kerfLeft.copy().mirrorX(length/2-BOARD_THICKNESS/2)
    );
  }

  return basePanel;
}

function doorHandleSub(w,h)
{
    return cylinder(w/2, 100).rotateX(90).moveTo(0,0,0);
}

//// MAIN ////

layer('frame').color('red');

pleft = panel(HEIGHT, DEPTH, 'vertical');
pright = pleft.copy().mirrorX((WIDTH-BOARD_THICKNESS)/2);
pbottom = panel(WIDTH, DEPTH, 'horizontal');
ptop = pbottom.copy().mirrorZ((HEIGHT)/2);

//// DIVIDERS ////

layer('grid').color('blue').dashed([1,1]);

gridVLineStart = line([0,0,-HEIGHT*0.5],[0,0,HEIGHT*1.5])
numGridVLines = DIVIDERS_VERTICAL+2;
gridVLinesDist = (WIDTH-BOARD_THICKNESS)/(numGridVLines-1);
gridVLines = gridVLineStart.row(numGridVLines, gridVLinesDist)

layer('dividers').color('green');

if(DIVIDERS_VERTICAL > 0)
{
  vDividerDepth = (FRONT_SLIDER_DOORS) ? DEPTH - 2*BOARD_THICKNESS : DEPTH;

  if(BACKPLATE)
  {
    vDividerDepth -= BOARD_THICKNESS;
  }

  vDivider = box(BOARD_THICKNESS, vDividerDepth, HEIGHT).place(0)
              .moveToX(gridVLines.at(1).center().x);

  if(FRONT_SLIDER_DOORS){ vDivider.moveY(BOARD_THICKNESS); }
  if(BACKPLATE){ vDivider.moveY(-BOARD_THICKNESS/2)};

  vDividers = vDivider.row(DIVIDERS_VERTICAL, gridVLinesDist-BOARD_THICKNESS);
  ptop.subtract(vDividers);
  pbottom.subtract(vDividers);
}

//// BACK PLATE ////

layer('backplate').color('brown');

if(BACKPLATE)
{
    backPlateSub = boxBetween([0,0,0],
      [WIDTH-BOARD_THICKNESS,BOARD_THICKNESS/2,HEIGHT])
        .moveY(DEPTH/2-BOARD_THICKNESS);

    ptop.subtract(backPlateSub);
    pbottom.subtract(backPlateSub)
    pleft.subtract(backPlateSub);
    pright.subtract(backPlateSub.removeFromScene());

    backPlate = boxBetween([0,0,0],
      [WIDTH-BOARD_THICKNESS,BOARD_THICKNESS,HEIGHT])
        .moveY(DEPTH/2-BOARD_THICKNESS)
        .name('backplate')
        .subtract(pleft,ptop,pright, pbottom);
}

//// FRONTS ////

if(FRONT_SLIDER_DOORS)
{
  frontSliderDoorRailsSub = boxBetween([BOARD_THICKNESS/2,0,0],
                                        [WIDTH-BOARD_THICKNESS*1.5,BOARD_THICKNESS/2,HEIGHT])
                            .moveY(-DEPTH/2+BOARD_THICKNESS/2).removeFromScene();

  pbottom.subtract(
        frontSliderDoorRailsSub.copy().removeFromScene(),
        frontSliderDoorRailsSub.copy().moveY(BOARD_THICKNESS).removeFromScene()
  )

  ptop.subtract(
            frontSliderDoorRailsSub.copy().removeFromScene(),
            frontSliderDoorRailsSub.copy().moveY(-BOARD_THICKNESS).removeFromScene()
  )

  layer('sliderdoors').color('purple')

  sliderDoorLeft = boxBetween(
                      [BOARD_THICKNESS/2,-DEPTH/2,0],
                    [(WIDTH-BOARD_THICKNESS)/2,-DEPTH/2+BOARD_THICKNESS,HEIGHT])
                  .subtract(pbottom,ptop)
                  .subtract(
                      doorHandleSub(20,50).moveTo(30,-DEPTH/2,HEIGHT/2).removeFromScene());

  sliderDoorRight = sliderDoorLeft.copy().mirrorX((WIDTH-BOARD_THICKNESS)/2)
                      .moveY(BOARD_THICKNESS);

  sliderDoorLeft.move($SLIDER_DOOR_OPEN/100*(WIDTH-BOARD_THICKNESS*2)/2);

}

plates = all().filter(s => s.type === 'Mesh')
    .forEach((s) => s.copy().layflat()
    .moveY(-3000)
    );

