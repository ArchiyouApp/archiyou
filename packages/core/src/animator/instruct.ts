/**
 *  animator/instruct.ts
 *
 *  An instructable as an animation: one track per part over the whole timeline, chapters
 *  from the steps. GLTFBuilder.addInstruct() bakes it, and the animator's `assembly` preset
 *  uses the same conversion, so a manual reads the same in both.
 *
 *  ## One track per part, not one per event
 *
 *  A part can be asked to be in two places over a manual: laid out in a row for the "here is
 *  what you need" step, and sliding into the assembly for the step that fits it. glTF allows
 *  exactly ONE channel per node per target path in an animation, so those cannot be written
 *  as two independent motions — they are resolved into a single track over the whole timeline
 *  first, which is what poseAfter() below does.
 *
 *  ## Where a part is during a step
 *
 *   - a `layout()` places it, as a rigid transform about its own centre (a StepPlacement);
 *   - it is the subject of a step with a `move()`: it ARRIVES during that step, so it starts
 *     one `distance` back along the motion;
 *   - before that step it is parked at that same approach position, which is what makes the
 *     clip read as an assembly rather than as a finished model with one twitching component.
 *     glTF cannot hide anything, so parking is how a part that arrives later is kept out of
 *     the way.
 */

import type { InstructData, StepData } from '../docs/instruct/types'
import type { AnimationData, Easing, PoseKey, Quat, TrackData, Vec3 } from './types'
import { IDENTITY_QUATERNION, isSameQuat, isSameVec, normalizeQuat, scaleVec, subtract } from './sampling'

interface InstructPose
{
    position: Vec3
    rotation: Quat
    /** How the part travels INTO this pose. */
    easing: Easing
}

/** The animation an instructable plays.
 *  @param centreOf the authored centre of a part, by scene path, for a part no layout gives
 *      one for (a part that only moves). Left unanswered, the baker takes it from the file. */
export function instructToAnimation(data: InstructData,
    centreOf?: (path: string) => Vec3 | undefined): AnimationData
{
    const steps = data?.steps ?? []

    /*  Every part any step has an opinion about. A part no step lays out or moves stays where
        the model has it and needs no track at all. */
    const paths = [...new Set<string>(steps.flatMap((step: StepData) => [
        ...(step.placements ?? []).map(p => p.path),
        ...((step.move && step.subject?.length) ? step.subject : []),
    ]))]

    return {
        name: data?.name ?? 'instruct',
        ...(data?.title ? { title: data.title } : {}),
        duration: data?.duration ?? 0,
        loop: 'none',
        tracks: paths.map(path => instructTrack(path, steps, data?.duration ?? 0, centreOf?.(path))),
        chapters: steps.map(step => ({ title: step.title, tStart: step.tStart, tEnd: step.tEnd })),
    }
}

function instructTrack(path: string, steps: Array<StepData>, duration: number,
    fallbackCentre: Vec3 | undefined): TrackData
{
    const moves = steps.filter(step => step.move && step.subject?.includes(path))
    const arrival = moves.length ? steps.indexOf(moves[0]) : -1

    /*  One approach per part. A part that is the subject of two moving steps would have to
        leave and arrive twice, which no manual means — and there is one track per part, so
        there is nowhere to put a second departure anyway. */
    if (moves.length > 1)
    {
        console.warn(`GLTFBuilder::addInstruct(): "${path}" moves in more than one step. `
            + `Only the first move is animated; the later ones are step data only.`)
    }

    /*  A layout knows the part's centre; a part that only moves takes it from the caller. One
        that only moves never turns, so without a centre its poses are written about [0,0,0]:
        offsets from where the model has it, which the baker applies the same way. */
    const placed = steps.flatMap(step => step.placements ?? []).find(p => p.path === path)
    const centre: Vec3 = placed ? [...placed.centre] as Vec3 : (fallbackCentre ?? [0, 0, 0])
    const authored: Vec3 = centre

    const approach = (arrival < 0) ? authored : subtract(
        authored, scaleVec(moves[0].move!.direction, moves[0].move!.distance))

    /** Where the part sits at the END of a step. `-1` asks where it sits before the first one:
     *  parked at its approach position, or laid out if the first step lays it out. */
    const poseAfter = (index: number): InstructPose =>
    {
        const step = steps[Math.max(index, 0)]
        const placement = (step?.placements ?? []).find(p => p.path === path)
        const easing = (step?.move?.interpolation ?? 'easeInOut') as Easing

        if (placement)
        {
            return {
                position: [...placement.position] as Vec3,
                // glTF requires unit quaternions on a rotation channel; a layout hands its own
                // back raw
                rotation: normalizeQuat(placement.rotation),
                easing,
            }
        }

        return {
            // before its own step, and at the end of every step before it, it is parked
            position: (arrival >= 0 && index < arrival) ? approach : authored,
            rotation: [...IDENTITY_QUATERNION],
            easing,
        }
    }

    const initial = poseAfter(-1)
    const poses = steps.map((_, i) => poseAfter(i))

    // hold, then ease across the step that changes it
    const key = (t: number, pose: InstructPose, easing: Easing): PoseKey =>
        ({ t, position: pose.position, rotation: pose.rotation, easing })

    const same = (a: InstructPose, b: InstructPose) =>
        isSameVec(a.position, b.position) && isSameQuat(a.rotation, b.rotation)

    const { keys, last } = poses.reduce((acc, pose, i) =>
    {
        if (same(pose, acc.last)) { return acc }
        return {
            keys: [...acc.keys,
                key(steps[i].tStart, acc.last, 'linear'),        // held where it was until this step starts…
                key(steps[i].tEnd, pose, pose.easing)],          // …then across it
            last: pose,
        }
    }, { keys: [key(0, initial, 'linear')], last: initial })

    return { path, centre, pose: [...keys, key(duration, last, 'linear')] }
}
