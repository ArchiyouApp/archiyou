Shape (most critical gap)
Meshup Shape is essentially just a marker interface with id(). BREP Shape has ~221 public methods covering:

Boolean ops: union, intersect, subtract, fuse
Transforms: extrude, loft, sweep, thicken, shell, mirror, rotate, scale
Patterns: array, arrayX, arrayY, arrayZ, arrayAlong
Selection: select, closest, intersecting, overlaps
Export: toSVG, toData, toMeshShape, toWire
Analysis: bbox, valid, isEmpty, is2D, is3D, checkAndFix
ShapeCollection
~96 of 144 methods missing in meshup. Key gaps:

Geometric filtering: faces, edges, shells, solids, vertices, wires
Analysis: area, bbox, boundary, contains, intersections, overlapping
Utilities: checkDowngrade, upgrade, lowestType, distinct
Export: toData, toDXF, toMeshShapeBuffer, toOcCompound
Edge → Meshup Curve (40 missing)
makeLine, makeCircle, makeArc, makeBezier, makeSpline, makeWeightedBezier, loft, lofted, thicken, thickened, segmentize, reversed, extendTo, extendedTo, offsetted, toWire, toVector, toDXF, tangent, tangentAt, normalAtPerc, directionAtPerc, pointAt, pointAtParam, edgeType, isCircular, dim, alignTo, angleTo, parallel

Sketch (18 missing)
circle, circleTo, rect, rectTo, splineTo, fillet, chamfer, union, subtract, intersection, mirror, thicken, thickened, cut, overlap, on, origin, atVertices

Vector (35 missing)
rotateX, rotateY, rotateZ, angleAround, angleRef, angles, angle2D, angleYZ, isNormalTo, isOpposite, isParallel, projectedToPlane, mirrored, reversed, crossed, divided, multiplied, squareMagnitude, distance, random, swappedXY, eulerAngles, sharedPlanes
(Meshup uses quaternion rotation instead of per-axis)

Bbox (30 missing)
top, bottom, front, right, line, box, shape, diagonal, axes2D, area, isPoint, minSize, maxSize, sizeAxis1D, getPositionAtPerc, depthHalfLine, widthHalfLine, flippedY, toData, hash

OBbox (35 missing)
corner, getSidesShape, contains, enlarged, left, back, maxAtAxis, minAtAxis, sizeAlongAxis, toShape, rect, volume, xDir, yDir, zDir, diagonal, area, isPoint, minSize, maxSize, sizeAxis1D

Point (18 missing)
add, added, moved, moveX, moveY, moveZ, flippedX, flippedY, flippedZ, project, isOrigin, equalsTolerance, roundToTolerance, rounded, sharedPlane, fromPointLike, cursor, toPoint

Vertex (17 missing)
extrude, extruded, move, project, rounded, fromPoint, fromVector, fromAll, fromPointLike, setX, setY, setZ, toArray, toData, center

Obj → Meshup Container (17 missing)
addToScene, allShapes, allShapesCollection, chroma, dashed, empty, getColor, hide, show, lineWidth, style, isCircular, shapeType, toComponentGraph, toData, toMeshShapeBuffer, toMeshShapes

Selector
Only gap: brep uses select(), meshup uses execute() — likely same function, different name.