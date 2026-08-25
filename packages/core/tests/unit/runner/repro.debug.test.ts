import { describe, it, expect } from 'vitest'
import { Runner } from '../../../src/runner/Runner'

const CODE = `
units('cm')
WIDTH = 600;
ROOF_ANGLE = 45;
WALL_HEIGHT = 200;
WALL_THICKNESS = 20;
BEAM_SECTION_WIDTH = 5;
BEAM_SECTION_HEIGHT = 15;
PURLIN_SECTION_WIDTH = 15;
PURLIN_SECTION_HEIGHT = 15;
COLLAR_TIE_OFFSET_FROM_TOP_PERCENT = 0.35;
DIAGONAL_BLOCK_TO_RAFTERS_BLOCK_PERCENT = 0.25;

layer('diagram').color('blue');
baseline = line([-WIDTH/2,0,0],[WIDTH/2,0,0]).name('baseline');
diagramWallLeft = sketch('front')
            .moveTo(baseline.start().x, 0)
            .lineTo('+0','+'+WALL_HEIGHT)
            .lineTo(''+WALL_THICKNESS,'+0')
            .lineTo('+0','-'+WALL_HEIGHT)
            .close()
            .end()
            .name('diagramWallLeft');
diagramWallRight = diagramWallLeft.copy().mirrorX(0);
diagramRoofLineLeft = line(
                        [baseline.start().x, 0, WALL_HEIGHT],
                        point(baseline.start().x, 0, WALL_HEIGHT)
                            .move(WIDTH/2, 0, Math.tan(toRad(ROOF_ANGLE)) * WIDTH/2)
                        )
diagramRoofLineRight = diagramRoofLineLeft.copy().mirrorX(0);
diagramDiagonalLineLeft = line(
                            diagramRoofLineLeft.center(),
                            diagramWallLeft.select('V||rightfrontbottom')
);
diagramDiagonalLineRight = diagramDiagonalLineLeft.copy().mirrorX(0);
diagramHammerBeamLeft = diagramWallLeft.select('E||topfront')
      .copy().extendTo(diagramDiagonalLineLeft)
diagramHammerBeamRight = diagramHammerBeamLeft.copy().mirrorX(0);
diagramColorTieLeftStart = diagramRoofLineLeft.end().copy().move(
                                diagramRoofLineLeft.direction().normalize()
                                    .reverse().scale(COLLAR_TIE_OFFSET_FROM_TOP_PERCENT * diagramRoofLineLeft.length())
                            );
diagramCollarTie = line(diagramColorTieLeftStart,
                        diagramColorTieLeftStart.copy().move(diagramColorTieLeftStart.x*-2));
diagramKingPost = line(diagramRoofLineLeft.end(), diagramCollarTie.center())
centerline = line(baseline.center(), diagramRoofLineLeft.end().moveZ(100) )
diagramPurlinTopLeft = diagramRoofLineLeft.copy()
                      .offset(-PURLIN_SECTION_HEIGHT)
                      .extendTo(centerline)

layer('beams').color('green');

kingPost = rectBetween(diagramCollarTie.center().move(-BEAM_SECTION_HEIGHT/2),
                         diagramRoofLineLeft.end().move(BEAM_SECTION_HEIGHT/2))
        .cutoffBy(diagramRoofLineLeft)
        .cutoffBy(diagramRoofLineRight)
        .extrude(BEAM_SECTION_WIDTH, [0,1,0])

collarTieBeam = diagramCollarTie.loft(
    diagramCollarTie.copy().move(0,0,-BEAM_SECTION_HEIGHT)
        .extendTo(diagramRoofLineLeft)
        .extendTo(diagramRoofLineRight)
).extrude(BEAM_SECTION_WIDTH, [0,1,0])

rafterLeftFront = diagramRoofLineLeft
    .copy()
    .connect(diagramPurlinTopLeft)
    .close()
    .hide()
    .toFace()
    .cutoff('z', diagramWallLeft.select('V||lefttop').z)
    .cutoff('x', 0)
    .extrude(BEAM_SECTION_WIDTH, [0,-1,0])
rafterLeftBack = rafterLeftFront.copy().moveY(BEAM_SECTION_WIDTH*2)

diagramDiagonalLineLeftBase = diagramDiagonalLineLeft
    .copy()
    .cutoffBy(diagramPurlinTopLeft);
diagonalLeftFront = diagramDiagonalLineLeftBase
    .copy()
    .offset(-BEAM_SECTION_HEIGHT)
    .extend(20)
    .cutoffBy(diagramPurlinTopLeft)
    .connect(diagramDiagonalLineLeftBase)
    .extrude(BEAM_SECTION_WIDTH, [0,-1,0])
    .cutoff('z', 0)
    .cutoff('x', diagramWallLeft.select('E||right').center().x)
diagonalLeftBack = diagonalLeftFront.copy().moveY(BEAM_SECTION_WIDTH*2).name('diagonalLeftBack')

diagonalRafterBlockLeftLine = line(
                            diagramRoofLineLeft.center(),
                            diagramRoofLineLeft.center()
                              .move(diagramDiagonalLineLeft.direction()
                                    .copy().scale(DIAGONAL_BLOCK_TO_RAFTERS_BLOCK_PERCENT))
)
.extend(30, 'start')
.cutoffBy(diagramRoofLineLeft)
diagonalRafterBlockLeft = diagonalRafterBlockLeftLine
                              .connect(
                                  diagonalRafterBlockLeftLine.copy().removeFromScene()
                                  .offset(-BEAM_SECTION_HEIGHT)
                                  .cutoffBy(diagramRoofLineLeft)
                              )
  .extrude(BEAM_SECTION_WIDTH, [0,1,0])

hammerBeamLeft = diagramHammerBeamLeft.copy()
                        .moveZ(BEAM_SECTION_HEIGHT)
                        .extendTo(diagramDiagonalLineLeft)
                        .extrude(BEAM_SECTION_HEIGHT, [0,0,-1])
                        .cutoffBy(diagramRoofLineLeft)
                        .extrude(BEAM_SECTION_WIDTH, [0,1,0])

rafterRightBack = rafterLeftBack.copy().mirrorX(0);
rafterRightFront = rafterLeftFront.copy().mirrorX(0);
diagonalRightFront = diagonalLeftFront.copy().mirrorX(0);
diagonalRightBack = diagonalLeftBack.copy().mirrorX(0);
diagonalRafterBlockRight = diagonalRafterBlockLeft.copy().mirrorX(0);
hammerBeamRight = hammerBeamLeft.copy().mirrorX(0);
`

// Manual debugging harness, not an assertion test: the final `toEqual('SHOW')`
// compares the scene dump against a sentinel string so vitest prints the whole
// tree in its diff. It can never pass by construction, so it is skipped to keep
// CI green. Flip to `describe.only` when you need the scene-graph dump.
describe.skip('repro missing shapes', () => {
  it('report scene', async () => {
    const runner = await new Runner().load()
    const result = await runner.execute({
      script: { code: CODE },
      outputs: ['default/model/glb'],
    } as any)
    const scope = runner.getActiveScope() as any
    // Walk the exported scene-node data tree (what the viewer renders).
    const state: any = (result as any).state
    const leaves: string[] = []
    const walk = (n: any, path: string) => {
      if (!n) return
      const p = path ? path + '/' + n.name : n.name
      if (n.shape != null) leaves.push(p + (n.style?.visible === false ? ' [HIDDEN]' : ''))
      ;(n.children ?? []).forEach((c: any) => walk(c, p))
    }
    // state may be the root node or {scenegraph|nodes|...}
    const root = state?.children ? state : (state?.scenegraph ?? state?.model ?? state?.nodes ?? state)
    walk(root, '')
    expect({ status: result.status, leafCount: leaves.length, leaves }).toEqual('SHOW')
  })
})
