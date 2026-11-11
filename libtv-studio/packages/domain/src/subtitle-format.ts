import type { TimelineRevision } from '../../contracts/src/timeline.ts';
export const assTime = (frame: number, fps: number) => Math.floor(100 * frame / fps);
function time(centiseconds: number): string {
    return Math.floor(centiseconds / 360000) + ':' + String(Math.floor(centiseconds / 6000) % 60).padStart(2, '0') + ':' + String(Math.floor(centiseconds / 100) % 60).padStart(2, '0') + '.' + String(centiseconds % 100).padStart(2, '0');
}
export function subtitleText(text: string): string {
    return text.replaceAll('\\', '＼').replaceAll('{', '｛').replaceAll('}', '｝').replace(/\r?\n/g, '\\N');
}
export function subtitleDocument(timeline: TimelineRevision): string {
    const style = timeline.subtitleStyle;
    const color = '&H00' + style.color.slice(5, 7) + style.color.slice(3, 5) + style.color.slice(1, 3);
    const frameTicks = 48000 / timeline.fps.num;
    return [
        '[Script Info]', 'ScriptType: v4.00+', 'PlayResX: ' + timeline.canvas.width, 'PlayResY: ' + timeline.canvas.height,
        '[V4+ Styles]',
        'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
        'Style: Default,Noto Sans CJK SC,' + style.fontSize + ',' + color + ',' + color + ',&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,' + style.outline + ',0,2,0,0,' + style.bottomMargin + ',1',
        '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
        ...timeline.subtitleCues.map(cue => 'Dialogue: 0,' + time(assTime(cue.startTicks / frameTicks, timeline.fps.num)) + ',' + time(assTime(cue.endTicks / frameTicks, timeline.fps.num)) + ',Default,,0,0,0,,' + subtitleText(cue.text)), '',
    ].join('\n');
}
