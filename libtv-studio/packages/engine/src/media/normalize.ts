import type { MediaProbe } from '../../../contracts/src/media-info.ts';
import type { TimelineSettings } from '../../../contracts/src/timeline.ts';
/** -noautorotate is mandatory: apply the recorded display matrix exactly once. */
export function pictureFilters(probe: MediaProbe | null, settings: TimelineSettings, fit: 'contain' | 'cover'): string {
    const stream = probe?.streams.find(value => value.kind === 'video');
    const rotation = stream?.rotation ?? 0;
    const rotate = rotation === 90 ? 'transpose=cclock,' : rotation === 270 ? 'transpose=clock,' : rotation === 180 ? 'hflip,vflip,' : '';
    const inputColor = stream?.colorSpace === 'bt709' ? 'bt709' : stream?.colorSpace === 'bt470bg' || stream?.colorSpace === 'smpte170m' ? 'bt601' : 'auto';
    const { width, height } = settings.canvas;
    const resize = fit === 'contain'
        ? 'scale=' + width + ':' + height + ':force_original_aspect_ratio=decrease:force_divisible_by=2:in_color_matrix=' + inputColor + ':out_color_matrix=bt709,pad=' + width + ':' + height + ':(ow-iw)/2:(oh-ih)/2:color=black'
        : 'scale=' + width + ':' + height + ':force_original_aspect_ratio=increase:force_divisible_by=2:in_color_matrix=' + inputColor + ':out_color_matrix=bt709,crop=' + width + ':' + height;
    // Convert non-square source pixels before fitting, rather than merely relabelling SAR.
    return rotate + 'scale=trunc(iw*sar/2)*2:ih,setsar=1,' + resize + ',setsar=1,format=yuv420p';
}
export function audioFilters(originSeconds: number, sourceInTicks: number, durationTicks: number, startTicks: number, gainMilli: number): string {
    return 'asetpts=PTS-' + originSeconds + '/TB,aresample=48000:async=0,atrim=start=' + sourceInTicks / 48000 + ':end=' + (sourceInTicks + durationTicks) / 48000 + ',asetpts=PTS-' + sourceInTicks / 48000 + '/TB,aresample=48000:first_pts=0,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=' + gainMilli / 1000 + ',adelay=' + startTicks + 'S:all=1';
}
