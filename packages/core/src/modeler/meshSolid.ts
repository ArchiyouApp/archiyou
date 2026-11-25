/**
 *  modeler/meshSolid.ts: is a shape a solid of the mesh kernel (meshup)?
 *
 *  meshup's solid class was called Mesh and its `type` was 'Mesh'. It is Solid now, with Mesh as
 *  an alias of the same class, and its `type` is 'Solid': the same as a solid of the brep kernel.
 *  So `type` no longer tells the two kernels apart; the class does.
 */

import { Solid } from '@archiyou/meshup';

/** A solid of the mesh kernel (meshup), not of brep */
export function isMeshSolid(shape: unknown): boolean
{
    return shape instanceof Solid;
}
