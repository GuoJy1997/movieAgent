import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import type { MediaReference } from '../../../../../../packages/contracts/src/assets.ts';
import { useRuntime } from '../../services/runtime.tsx';

export function MediaPreview({ media, original = false, thumbnail = false, onKind, onAvailability, previewRange }: { media: MediaReference; original?: boolean; thumbnail?: boolean; onKind?(video: boolean): void; onAvailability?(available:boolean):void; previewRange?: { startTicks: number; durationTicks: number } }) {
  const { descriptor } = useRuntime();
  const retried = useRef(false), player = useRef<HTMLMediaElement|null>(null);
  const resume = useRef<{ time: number; playing: boolean } | null>(null);
  const [videoSource, setVideoSource] = useState('');
  const identity = JSON.stringify([media, descriptor?.connectionEpoch]);
  const currentIdentity = useRef(identity);
  useEffect(()=>()=>{const media=player.current;if(media){media.pause();media.removeAttribute('src');media.load();}},[identity]);
  const query = useQuery({
    queryKey: [media.libraryId, descriptor?.connectionEpoch, 'media', media, original, thumbnail],
    staleTime: 60000, refetchInterval: 90000, refetchIntervalInBackground: true,
    queryFn: async () => {
      const issue = async (variant: 'original' | 'thumbnail') => {
        const result = await window.studio.mediaUrl({ libraryId: media.libraryId, ref: media, variant });
        if (!result.ok) throw new Error(result.error.message);
        return result.value;
      };
      const url = await issue('original');let retainOriginal=false;
      try{
      // Only a local expiring capability is probed; media bytes stay out of query data.
      const head = await fetch(url, { method: 'HEAD' });
      if (!head.ok) throw new Error('媒体读取失败');
      const mime = head.headers.get('content-type')?.split(';')[0];
      if (mime === 'text/plain') {
        const response = await fetch(url); if (!response.ok) throw Error('文本读取失败');
        const text = await response.text();
        return { url, video: false, audio: false, text: thumbnail ? text.slice(0, 320) : text };
      }
      const video = mime === 'video/mp4' && !thumbnail;
      const audio = Boolean(mime?.startsWith('audio/'));
      retainOriginal=video||audio||original&&!thumbnail;
      return { url: retainOriginal ? url : await issue('thumbnail'), video, audio };
      }finally{if(!retainOriginal)await window.studio.releaseMediaUrl(url).catch(()=>{});}
    },
  });
  useEffect(() => {
    if (currentIdentity.current !== identity) {
      currentIdentity.current = identity; setVideoSource(''); retried.current = false; resume.current = null;
    }
    if (query.data) {
      onKind?.(query.data.video);
      if(query.data.text!==undefined)onAvailability?.(true);
      // Renew capabilities in the background without resetting a loaded video.
      if (query.data.video || query.data.audio) setVideoSource(current => current || query.data.url);
    }
  }, [identity, query.data, onKind]);
  useEffect(()=>{if(query.error)onAvailability?.(false);},[query.error,onAvailability]);
  async function renewVideo() {
    onAvailability?.(false);
    const token=identity;
    if (retried.current) { player.current?.parentElement?.setAttribute('data-media-error', '视频读取失败，请重新打开预览'); return; }
    retried.current = true;
    const video = player.current;
    if (video) resume.current = { time: video.currentTime, playing: !video.paused && !video.ended };
    const fresh = await query.refetch();
    if(currentIdentity.current!==token)return;
    if (fresh.data?.video || fresh.data?.audio) setVideoSource(fresh.data.url);
  }
  function enforcePreviewRange(media: HTMLMediaElement) {
    if (!previewRange) return;
    if (media.currentTime < previewRange.startTicks / 48000) media.currentTime = previewRange.startTicks / 48000;
    if (media.currentTime >= (previewRange.startTicks + previewRange.durationTicks) / 48000) media.pause();
  }
  if (query.data?.text !== undefined) return <pre className="text-media-preview nodrag nopan nowheel" aria-label="固定版本文本预览">{query.data.text}</pre>;
  if (query.data?.audio) return <audio ref={node=>{player.current=node;}} aria-label="固定版本音频预览" controls preload="metadata" src={videoSource||query.data.url} onPlay={event=>{if(previewRange && (event.currentTarget.currentTime < previewRange.startTicks/48000 || event.currentTarget.currentTime >= (previewRange.startTicks+previewRange.durationTicks)/48000))event.currentTarget.currentTime=previewRange.startTicks/48000;}} onTimeUpdate={event=>enforcePreviewRange(event.currentTarget)} onSeeking={event=>enforcePreviewRange(event.currentTarget)} onLoadedData={()=>{retried.current=false;}} onLoadedMetadata={()=>{onAvailability?.(true);const pending=resume.current,media=player.current;resume.current=null;if(pending&&media){media.currentTime=pending.time;if(pending.playing)void media.play().catch(()=>{});}else if(media&&previewRange)media.currentTime=previewRange.startTicks/48000;}} onError={()=>void renewVideo()}/>;
  if (query.data?.video) return <video
    ref={node=>{player.current=node;}} className="nodrag nopan nowheel" aria-label="固定版本视频预览" controls preload="metadata"
    src={videoSource || query.data.url}
    onLoadedData={() => { retried.current = false; player.current?.parentElement?.removeAttribute('data-media-error'); }}
    onLoadedMetadata={() => {
      onAvailability?.(true);
      const pending = resume.current, video = player.current; resume.current = null;
      if (pending && video) { video.currentTime = pending.time; if (pending.playing) void video.play().catch(() => {}); }
    }}
    onError={() => void renewVideo()}
    onPointerDown={event => event.stopPropagation()}
    onDoubleClick={event => event.stopPropagation()}
  />;
  return query.data ? <img src={query.data.url} alt={thumbnail ? '媒体缩略图；视频使用通用播放图标，非视频帧' : '固定版本图像预览'}
    onLoad={event => { onAvailability?.(true); retried.current = false; event.currentTarget.hidden = false; event.currentTarget.parentElement?.removeAttribute('data-media-error'); }}
    onError={event => {
      onAvailability?.(false);
      if (!retried.current) { retried.current = true; void query.refetch(); }
      else { event.currentTarget.hidden = true; event.currentTarget.parentElement?.setAttribute('data-media-error', '媒体暂不可用'); }
    }}
  /> : <span className="media-placeholder">{query.error ? '媒体读取失败，可重新打开预览' : '正在读取媒体…'}</span>;
}
