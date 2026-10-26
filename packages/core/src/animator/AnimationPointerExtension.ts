/**
 *  animator/AnimationPointerExtension.ts
 *
 *  KHR_animation_pointer for gltf-transform, which has no class for it (core 4.3.0 ships
 *  none, and @gltf-transform/extensions is not a dependency). Written the way meshup writes
 *  the extensions glTF has no class for (BentleyLineStyleExtension, meshup GLTFBuilder.ts).
 *
 *  glTF animates translation, rotation, scale and morph weights of NODES. This extension lets
 *  a channel point at any other animatable property instead, by JSON pointer: what Archiyou
 *  uses it for is a part's material colour and opacity,
 *
 *      "target": { "path": "pointer",
 *                  "extensions": { "KHR_animation_pointer":
 *                      { "pointer": "/materials/3/pbrMetallicRoughness/baseColorFactor" } } }
 *
 *  A channel like that has no target node. Viewers that do not know the extension skip it and
 *  still play the motion (three.js's GLTFLoader drops channels without a node), so the
 *  extension is listed in `extensionsUsed` and never in `extensionsRequired`.
 *
 *  ## How it is held in the Document
 *
 *  An AnimationPointer on an AnimationChannel names the Material and the property path inside
 *  it. The pointer string needs the material's INDEX, which only exists while writing, so it
 *  is built in write(): gltf-transform calls an extension's write() after `json.animations`
 *  has been written, with `materialIndexMap` and `animationIndexMap` filled.
 *
 *  Only material pointers are understood. Anything else read from a file is kept as its raw
 *  pointer and written back unchanged.
 */

import {
    Extension, ExtensionProperty, PropertyType,
    type Material, type ReaderContext, type WriterContext,
} from '@gltf-transform/core'

export const KHR_ANIMATION_POINTER = 'KHR_animation_pointer'

/** The `target.path` of a pointer channel. Not one of gltf-transform's own target paths. */
export const POINTER_TARGET_PATH = 'pointer'

/** The property of a material Archiyou animates: RGB colour and alpha in one VEC4. */
export const BASE_COLOR_FACTOR = 'pbrMetallicRoughness/baseColorFactor'

/** What one pointer channel targets. Attached to an AnimationChannel. */
export class AnimationPointer extends ExtensionProperty
{
    public static readonly EXTENSION_NAME = KHR_ANIMATION_POINTER;
    public readonly extensionName = KHR_ANIMATION_POINTER;
    public readonly propertyType = 'AnimationPointer';
    public readonly parentTypes = [PropertyType.ANIMATION_CHANNEL];

    /** The material whose property is animated, or null for a raw pointer read from a file. */
    public material: Material | null = null;
    /** The property inside the material, like 'pbrMetallicRoughness/baseColorFactor'. */
    public property = '';
    /** A pointer this class does not understand, kept as it was read. */
    public raw: string | null = null;

    protected init(): void {}
    protected getDefaults() { return super.getDefaults(); }
}

export class AnimationPointerExtension extends Extension
{
    public static readonly EXTENSION_NAME = KHR_ANIMATION_POINTER;
    public readonly extensionName = KHR_ANIMATION_POINTER;

    /** A pointer at a property of a material. */
    createPointer(material: Material, property: string): AnimationPointer
    {
        const pointer = new AnimationPointer(this.document.getGraph());
        pointer.material = material;
        pointer.property = property;
        return pointer;
    }

    read(context: ReaderContext): this
    {
        const json = context.jsonDoc.json as { animations?: Array<any> };

        (json.animations ?? []).forEach((animationDef: any, animationIndex: number) =>
        {
            const channels = context.animations[animationIndex]?.listChannels() ?? [];

            (animationDef.channels ?? []).forEach((channelDef: any, channelIndex: number) =>
            {
                const pointer = channelDef?.target?.extensions?.[KHR_ANIMATION_POINTER]?.pointer;
                const channel = channels[channelIndex];
                if (typeof pointer !== 'string' || !channel) { return }

                const prop = new AnimationPointer(this.document.getGraph());
                const match = pointer.match(/^\/materials\/(\d+)\/(.+)$/);
                const material = match ? context.materials[parseInt(match[1], 10)] : undefined;

                if (match && material)
                {
                    prop.material = material;
                    prop.property = match[2];
                }
                else
                {
                    prop.raw = pointer;
                }

                channel.setExtension(KHR_ANIMATION_POINTER, prop);
            });
        });

        return this;
    }

    write(context: WriterContext): this
    {
        const json = context.jsonDoc.json as { animations?: Array<any> };
        if (!json.animations) { return this }

        this.document.getRoot().listAnimations().forEach(animation =>
        {
            const animationIndex = context.animationIndexMap.get(animation);
            const animationDef = (animationIndex === undefined) ? undefined : json.animations![animationIndex];
            if (!animationDef) { return }

            // the writer emits channels in listChannels() order, so the indices match
            animation.listChannels().forEach((channel, channelIndex) =>
            {
                const prop = channel.getExtension<AnimationPointer>(KHR_ANIMATION_POINTER);
                const channelDef = animationDef.channels?.[channelIndex];
                if (!prop || !channelDef) { return }

                const materialIndex = prop.material ? context.materialIndexMap.get(prop.material) : undefined;
                const pointer = (materialIndex !== undefined)
                    ? `/materials/${materialIndex}/${prop.property}`
                    : prop.raw;
                if (!pointer) { return }

                channelDef.target = {
                    path: POINTER_TARGET_PATH,
                    extensions: { [KHR_ANIMATION_POINTER]: { pointer } },
                };
            });
        });

        return this;
    }
}
