/** Main module for Archiyou Brep */

import { OcLoader } from './OcLoader';

// global oc
let _oc: any = null;

export function getOc(): any 
{
  if(!_oc)
  {
    throw new Error('getOc(): OpenCascade not initialized. Call await init() first!');
  }
  return _oc;
}

export function setOc(oc: any): void
{
    _oc = oc;
}

//// INIT FUNCTION ////

export async function init():Promise<any>
{
    // Check if already initialized
    if (_oc)
    {
        console.warn('init(): Already initialized, skipping...');
        return _oc;
    }

    const ocLoader = new OcLoader();
    await ocLoader.loadAsync();

    // Set basic global _oc 
    console.info(`OcLoader::_onOcLoaded(): Setting global _oc`);

    setOc(ocLoader._oc);

    return _oc;
}


//// RE-EXPORTS ////

export * from './types'
export * from './constants'
export * from './utils'
export * from './typeguards'
export * from './inputSchemas'
export * from './decorators'
export * from './Point'
export * from './Vector'
export * from './Bbox'
export * from './Shape'
export * from './ShapeCollection'
export * from './Vertex'
export * from './VertexCollection'
export * from './Edge'
export * from './Wire'
export * from './Face'
export * from './Shell'
export * from './Solid'
export * from './OBbox'



export * from './Exporter'
export * from './Selector'

/** Convenience type alias for the brep module namespace itself. */
export type Brep = typeof import('./index')
