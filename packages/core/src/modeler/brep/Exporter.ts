
// constants
import { MESHING_MAX_DEVIATION, MESHING_ANGULAR_DEFLECTION, MESHING_MINIMUM_POINTS, MESHING_TOLERANCE, MESHING_EDGE_MIN_LENGTH } from './constants';

import type { ArchiyouApp, AnyShapeOrCollection,
    ExportGLTFOptions, MeshingQualitySettings,
    toSVGOptions } from './types'

import { isBrowser } from './utils'

import { Shape } from './Shape'
import { ShapeCollection } from './ShapeCollection'
import { GLTFBuilder } from './GLTFBuilder'
import { RunnerOps } from '../../runner/RunnerOps'
import type { AnyShape } from './types'

type XmlNode = any; // TODO

//// TYPES ////

// avoid TS errors by extending global
declare global {

    interface Window {
        showOpenFilePicker:any,
        showSaveFilePicker:any,
    }

    interface globalThis
    {
        showOpenFilePicker:any,
        showSaveFilePicker:any,
    }

    interface Console {
        geom:any,
        user:any,
    }
}


import { getOc } from './index' // OC global getter

export class Exporter
{
    //// SETTINGS ////
    DEFAULT_MESH_QUALITY = {
        linearDeflection: MESHING_MAX_DEVIATION,
        angularDeflection: MESHING_ANGULAR_DEFLECTION,
        tolerance: MESHING_TOLERANCE,
        edgeMinimalPoints: MESHING_MINIMUM_POINTS,
        edgeMinimalLength: MESHING_EDGE_MIN_LENGTH,
    }

    DEFAULT_GLTF_OPTIONS = {
        binary: true,
        archiyouFormat: true,
        archiyouOutput: { metrics: true, tables: true, docs: false, pipelines:true, formats: true, messages: true },
        includePointsAndLines: true,
        extraShapesAsPointLines: true,
        messages: [],
    } as ExportGLTFOptions

    //// END SETTINGS ////

    _ay:ArchiyouApp; // New method, see set Archiyou

    constructor(ay?:ArchiyouApp) 
    {
        this._ay = ay;
    }

    setArchiyou(ay:ArchiyouApp):this
    {
        this._ay = ay;
        return this;
    }

    /** Export given shapes or all shapes in Brep instance to STEP 
     *  Optionally supply a filename
    */
    exportToSTEP(shapes?:AnyShape|ShapeCollection, options:Record<string,any> = {}, filename?:string):string
    {
        // Taken from: https://github.com/zalo/CascadeStudio/blob/1a0f44b4d7617cc9dfc1dd6833945e04e2dfc1c9/js/CADWorker/CascadeStudioFileUtils.js

        /* 
            OC docs:
            - https://dev.opencascade.org/doc/refman/html/class_s_t_e_p_control___writer.html
            - Output modes: https://dev.opencascade.org/doc/refman/html/_s_t_e_p_control___step_model_type_8hxx.html#a032affe8dae498d429a83225f8c5da4e
        */

        const shapesToExport = new ShapeCollection(shapes as AnyShape);

        filename = filename || this._getFileName() + '.step';
        // Export given shape(s) or all in Brep instance
        const sceneShapes = (shapesToExport.length) 
                                ? shapesToExport 
                                : this._visibleSceneShapes();
        const sceneCompoundShape = new ShapeCollection(sceneShapes).toOcCompound(); // filter might return only one Shape

        console.info(`Exporter::exportToSTEP: Output of ${sceneCompoundShape.NbChildren()} Shapes`);

        const oc = getOc();
        
        let ocWriter = new oc.STEPControl_Writer_1();
        let ocTransferResult = ocWriter.Transfer(sceneCompoundShape, 0, true, new oc.Message_ProgressRange_1()); 
        ocTransferResult = ocTransferResult.value; // return a struct: use value() to get real value
        if (ocTransferResult === 1)
        {
            // Write the STEP File to the virtual Emscripten Filesystem Temporarily
            let writeResult = ocWriter.Write(filename);
            writeResult = writeResult.value;
            if (writeResult === 1)
            {
                // Read the STEP File from the filesystem and clean up
                let stepFileText = oc.FS.readFile("/" + filename, { encoding:"utf8" });
                oc.FS.unlink("/" + filename);

                // Return the contents of the STEP File
                return stepFileText;
            }
            else
            {
                console.error("Exporter::exportToSTEP: File Export Transfer to STEP failed");
            }
        }
        else 
        {
            console.error("Exporter::exportToSTEP: File Export to STEP failed");
        }
    }

    /** Open a window to save the file in browser */
    async exportToSTEPWindow(content?:string)
    {
        const stepContent = content || this.exportToSTEP();
        await this._exportToFileWindow(stepContent, 'text/plain', 'step', 'STEP file');
    }

    /** Export given shapes or all shapes in Brep instance to STL
     *  Optionally supply a filename
    */
    exportToSTL(shapes?:AnyShape|ShapeCollection, options:Record<string,any> = {}, filename?:string):Uint8Array
    {
        const oc = getOc();
        
        filename = (filename || this._getFileName());
        if(!filename.includes(".stl")) filename += '.stl';

        const shapesToExport = new ShapeCollection(shapes);

        const visibleShapes = (shapesToExport.length) 
                                    ? shapesToExport 
                                    : this._visibleSceneShapes();

        // IMPORTANT: Make sure all shapes are triangulated before exporting to STL
        // TODO: avoid doing this multiple times if already done before GLTF
        this._triangulateShapes(visibleShapes);

        const sceneCompoundShape = visibleShapes.toOcCompound();

        console.info(`Exporter::exportToSTEP: Output of ${sceneCompoundShape.NbChildren()} Shapes`);
        const ocStlWriter = new oc.StlAPI_Writer();
        ocStlWriter.ASCIIMode = false; // binary
        const result = ocStlWriter.Write(sceneCompoundShape, filename, new oc.Message_ProgressRange_1()); // Shape, stream content, ASCI or not

        if (!result)
        {
            console.error(`Exporter::exportToSTL: Error exporting to STL. Try again, or another format!`);
            return null;
        }
        else {
            const stlFileBinary = oc.FS.readFile("/" + filename, { encoding:"binary" });
            oc.FS.unlink("/" + filename);
            return stlFileBinary?.buffer;
        }
        
    }

    /** Open a window to save the STL file in browser */
    async exportToSTLWindow(content?:ArrayBuffer)
    {
        const stlContent = content || this.exportToSTL();
        await this._exportToFileWindow(stlContent, 'application/octet-stream', 'stl', 'STL file');
    }

    /** Export Scene to GLTF 
        
        Export high-resolution GLTF with added loose Points and Lines. And optionally export seperate Vertices and Edges per Shape

        OC docs: 
        - RWGltf_CafWriter: https://dev.opencascade.org/doc/refman/html/class_r_w_gltf___caf_writer.html
        - XCAFDoc_DocumentTool: - https://dev.opencascade.org/doc/refman/html/class_x_c_a_f_doc___document_tool.html
        - ShapeTool: https://dev.opencascade.org/doc/refman/html/class_x_c_a_f_doc___shape_tool.html
        - TDF_Label: https://dev.opencascade.org/doc/refman/html/class_t_d_f___label.html
        - TDataStd_Name: https://dev.opencascade.org/doc/refman/html/class_t_data_std___name.html
        - VisMaterialTool: https://dev.opencascade.org/doc/refman/html/class_x_c_a_f_doc___vis_material_tool.html#aaa1fb4d64b9eb24ed86bbe6d368010ab
        - XCAFDoc_VisMaterial - https://dev.opencascade.org/doc/refman/html/class_x_c_a_f_doc___vis_material.html
        - VisMaterialPBR: https://dev.opencascade.org/doc/refman/html/struct_x_c_a_f_doc___vis_material_p_b_r.html

    */
    /**
     *  GLB export for brep geometry now goes through the SHARED exporter, not OpenCascade's
     *  RWGltf_CafWriter. See Shape.toGLTF() / ShapeCollection.toGLTF(), which tessellate into
     *  meshup shapes (brep/toMeshup.ts) and write the file with the mesh kernel's GLTF builder.
     *
     *  The OpenCascade route that used to live here was already dead: it called four
     *  GLTFBuilder methods (addPointsAndLines, addSeperatePointsAndLinesForShapes,
     *  addArchiyouData, toGLTFBuffer) that no longer exist, so it threw on its default options.
     *  Routing through one exporter also means brep and mesh runs emit the same extensions,
     *  extras and node names.
     */
    /** Ensure every Shape carries a triangulation before an OC writer walks it. */
    _triangulateShapes(shapes:ShapeCollection, meshingQuality?:MeshingQualitySettings):Array<any>
    {
        const oc = getOc();
        meshingQuality = meshingQuality || this.DEFAULT_MESH_QUALITY;
        const ocIncMeshes = [] as Array<any>;
        new ShapeCollection(shapes)
            .forEach(entity =>
            {
                if(Shape.isShape(entity))
                {
                    const ocShape = (entity as any)._ocShape;
                    ocIncMeshes.push(new oc.BRepMesh_IncrementalMesh_2(
                        ocShape, meshingQuality.linearDeflection, false, meshingQuality.angularDeflection, false));
                }
            })
        return ocIncMeshes;
    }

    /** Every visible Shape in the host Modeler's scene, or an empty collection when this
     *  Exporter has no host (a standalone brep session). Replaces the old Brep.all(). */
    _visibleSceneShapes():ShapeCollection
    {
        const all = (this._ay as any)?.modeler?.all?.();
        if(!all){ return new ShapeCollection() }
        return new ShapeCollection(all.toArray().filter((s:any) => s.visible?.() !== false));
    }

    async exportToGLTF(shapes?:AnyShapeOrCollection, _options?:ExportGLTFOptions, _filename?:string):Promise<ArrayBuffer|null>
    {
        const target = shapes ?? null;
        if(!target)
        {
            console.error(`Exporter::exportToGLTF(): No shapes to export`);
            return null;
        }
        return await (target as any).toGLTF();
    }

    /** Export entire (visual) model by creating a isometric 2D view  
     * TODO: seperate these functions into export3DtoSVG and export2DtoSVG
    */
    exportToSVG(shapes?:ShapeCollection, options:toSVGOptions={}):string
    {
        const shapesToExport = ShapeCollection.isShapeCollection(shapes) 
                                    ? shapes // only selected shapes
                                    : this._visibleSceneShapes(); // all visible ones in scene

        // if user forces only 2D export or shapes are all 2D anyway
        if(options?.only2D || shapesToExport.toArray().every(s => s.is2DXY()))
        {
            return this._export2DToSVG(shapesToExport, options);
        }
        else {
            console.info(`Exporter::exportToSVG(): Exporting from 3D to 2D using isometry. If you want only the 2D set only2D to true`)
            return this._export3DToSVG(shapesToExport, options);
        }

    }

    /** Shortcut function to export 3D shapes to SVG 
        Make a isometry first
    */
    _export3DToSVG(shapes:ShapeCollection, options:toSVGOptions={})
    {
        if(!ShapeCollection.isShapeCollection(shapes) || shapes.length === 0)
        { 
            throw new Error(`Exporter::_export3DToSVG(): Please supply a ShapeCollection with at least one shape!`);
        }
        return shapes._isometry().toSVG(options);
    }

    /** Export 2D shapes to SVG */
    _export2DToSVG(shapes:ShapeCollection, options:toSVGOptions={})
    {
        if(!ShapeCollection.isShapeCollection(shapes) || shapes.length === 0)
        { 
            throw new Error(`Exporter::_export2DToSVG(): Please supply a ShapeCollection with at least one shape!`);
        }
        return shapes.toSVG(options);
    }

    /** Combine all SVG's into one with SMIL keyframe animations
     *  We parse all SVGs and put all their content in seperate groups named "frame{{N}}"
     *  At the same time apply special SLIM SVG keyframe animation tags 
     *  so the SVG animation can be viewed inside ordinary browsers
     */
    exportToSVGAnimation(svgs:Array<string>):string
    {
        const SVG_FPS = 2; // 2 frames per second
        const SVG_FRAME_DURATION = 1 / SVG_FPS;

        const svgRootNodes = [] as Array<any>;
        const svgFrameGroups = [] as Array<string>; // <g id="frameN"><set id="anN" />{{ svg paths }}</g>
        const numFrames = svgs.length;

        return null;
        // TODO: Implement after change to fast-xml-parser
        /*

        svgs.forEach( (svg,frameNum) => {
            const parsedSvg = txml.parse(svg)[0];
            svgRootNodes.push(parsedSvg); // to find largest bbox later
            const pathNodes = txml.filter(parsedSvg.children, node => node.tagName === 'path'); // SVG only consists of path elements

            const svgFrameGroup = `
                        <g id="frame${frameNum}" visibility="hidden">
                            <set id="an${frameNum*2}" attributeName="visibility" begin="${SVG_FRAME_DURATION*frameNum}; an${frameNum*2+1}.end" to="visible" dur="${SVG_FRAME_DURATION}s" />
                            <set id="an${frameNum*2+1}" attributeName="visibility" begin="an${frameNum*2}.end" to="hidden" dur="${numFrames*SVG_FRAME_DURATION-SVG_FRAME_DURATION}s" />
                            ${pathNodes.map(p => this._XmlNodeToString(p)).join('')}
                        </g>`
            svgFrameGroups.push(svgFrameGroup);
        })

        // Get biggest bounding box
        svgRootNodes.sort( (a,b) => this._getSvgBboxArea(b) - this._getSvgBboxArea(a))
        const svgAnimated = this._XmlNodeToString(svgRootNodes[0], svgFrameGroups.join('\n')); // Wrap al groupes with largest SVG bbox

        return svgAnimated
        */
    }

    /** For some reason TXML does not offer a good node.toString() method */
    _XmlNodeToString(n:any, wrapped:string=''):string
    {
        const attrsStr = Object.keys(n.attributes).map( attr => `${attr}="${n.attributes[attr]}"`).join(' ');
        return `<${n.tagName} ${attrsStr}>${wrapped}</${n.tagName}>`
    }

    _getSvgBboxArea(svg:XmlNode):number
    {
        const bbox = svg.attributes['viewBox']?.split(' ');
        return (bbox) ? bbox[2] * bbox[3] : 0;
    }

    /** Open browser file window to save svg */
    async exportToSVGWindow(content:string)
    {
       await this._exportToFileWindow(content, 'text/svg', 'svg', 'SVG file');
    }

    exportToDXF(shapes?:AnyShape|ShapeCollection, options:Record<string,any> = {}):string|null
    {
        const shapesToExport = new ShapeCollection(shapes);
        const exportShapes = (shapesToExport.length) 
                            ? shapesToExport 
                            : this._visibleSceneShapes();

        if(exportShapes.length === 0)
        {
            console.warn(`Exporter::exportToDXF(): No visible shapes to export to DXF`);
            return null;
        }
        return exportShapes.toDXF();
    }


    /** Convenience method for exporting Shapes and save as file in browser and node
     *  @returns The file path or null if not successful
     *  IMPORTANT: save function in browser needs to be tied to user interaction
    */
    async save(filename:string, options:any={}, shapes?:ShapeCollection):Promise<string|undefined>
    {
        const EXTENTIONS_EXPORT_METHODS = {
            // extentions and mapping to exporter method
            'glb' : async (exp, shapes, filename, options) => await exp.exportToGLTF(shapes, options, filename),
            'svg': async (exp, shapes, filename, options) => exp.exportToSVG(shapes, options),
            'step': async (exp, shapes, filename, options) => exp.exportToSTEP(shapes, options, filename),
            'stl': async (exp, shapes, filename, options) => exp.exportToSTL(shapes, options, filename),
            'dxf' : async (exp, shapes, filename, options) => exp.exportToDXF(shapes, options, filename),
            // TODO: more
        }

        const ext = filename.split('.').pop();
        if(!Object.keys(EXTENTIONS_EXPORT_METHODS).includes(ext))
        {
            console.error(`Shape::save: Unsupported file extension to save file "${filename}".
                Please use any of these extensions: ${Object.keys(EXTENTIONS_EXPORT_METHODS).join(', ')}.
                Or as developer set mapping to export functions`);
            return;
        }
        const data = await EXTENTIONS_EXPORT_METHODS[ext](this, shapes, options, filename);        

        return await this._saveDataToFile(data, filename);
    }

    /** save raw data to file in browser of node
     *  returns the file path or undefined if not successful
    */
    async _saveDataToFile(data:any, filename:string):Promise<string|undefined>
    {
        if (isBrowser())
        {
            this.saveDataToFileWindow(data, filename);
            return filename; // no file path, only filename
        }
        else {
            // We are in backend Node
            const ops = new RunnerOps(); // some utils
            return await ops.saveBlobToFile(data, filename); // full path
        }
    }

    //// UTILS ////

    /** Simplified function to output data to a file window */
    async saveDataToFileWindow(data, filename:string)
    {
        const mime = this._mimeFromFileName(filename);
        const ext = filename.split('.').pop();
        await this._exportToFileWindow(data, mime, ext, `Save .${ext} File`);
    }

    /** Write data to local disk by opening a file picker in browser */
    async _exportToFileWindow(data:any, mime:string, ext:string, desc:string)
    {
        const fileHandle = await this.getNewFileHandle(desc, mime, ext);
        // Create a FileSystemWritableFileStream to write to
        const writable = await fileHandle.createWritable();
        // Write the contents of the file to the stream
        await writable.write(data);
        // Close the file and write the contents to disk.
        await writable.close();
        console.info(`Exporter::exportToWindow(): Saved file "${fileHandle.name}"`);
    }

    _getFileName():string
    {
        // Try to get script name from parent (Webworker (likely!), or Main))
        // TODO: Fix with new Runner structure
        return this._ay?.worker?.lastExecutionRequest?.script?.file_name || 'exportmodel';
    }

    _mimeFromFileName(fileName:string):string
    {
        const ext = fileName.split('.').pop();
        switch(ext)
        {
            case 'svg': return 'image/svg+xml';
            case 'dxf': return 'application/dxf';
            case 'stl': return 'application/sla';
            case 'step': return 'application/step';
            case 'glb': return 'model/gltf-binary';
            default: return 'application/octet-stream';
        }
    }

    // Taken from Cascade Studio
    async getNewFileHandle(desc, mime, ext, open = false)
    {
        const options = {
          types: [
            {
              description: desc,
              accept: {
                [mime]: ['.' + ext],
              },
            },
          ],
        };

        // open
        if (open) 
        {
            if (window.showOpenFilePicker) 
            {
                return await window.showOpenFilePicker(options);
            } 
            else {
                throw new Error("File Open Picker is not supported in this browser.");
            }
        } 
        // save
        else {
            // Chrome supports the file system API
            if (window.showSaveFilePicker)
            {
                return await window.showSaveFilePicker(options);
            } 
            else {
                // Fallback for unsupported browsers
                const exportFileName =  `${this._getFileName()}.${ext}`;
                return {
                    name:exportFileName,
                    async createWritable() 
                    {
                        const blobParts: Blob[] = [];
                        return {
                            async write(contents: Blob) 
                            {
                                blobParts.push(contents);
                            },
                            async close() {
                                const blob = new Blob(blobParts, { type: mime });
                                const url = URL.createObjectURL(blob);
                                const a = document.createElement('a');
                                a.href = url;
                                a.download = exportFileName;
                                a.click();
                                URL.revokeObjectURL(url);
                            },
                        };
                    },
                };
            }
        }
    }



}