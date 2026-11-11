import { FolderOpen } from '@phosphor-icons/react/dist/ssr/FolderOpen';
import { FilmSlate } from '@phosphor-icons/react/dist/ssr/FilmSlate';
import { Sparkle } from '@phosphor-icons/react/dist/ssr/Sparkle';
import { MonitorPlay as PlaySquare } from '@phosphor-icons/react/dist/ssr/MonitorPlay';
import { ClipboardText } from '@phosphor-icons/react/dist/ssr/ClipboardText';
import { GearSix } from '@phosphor-icons/react/dist/ssr/GearSix';
import { Plus } from '@phosphor-icons/react/dist/ssr/Plus';
import { ArrowUpRight } from '@phosphor-icons/react/dist/ssr/ArrowUpRight';
import { ImageSquare } from '@phosphor-icons/react/dist/ssr/ImageSquare';
import { Clock } from '@phosphor-icons/react/dist/ssr/Clock';
import { Selection } from '@phosphor-icons/react/dist/ssr/Selection';
import { SidebarSimple } from '@phosphor-icons/react/dist/ssr/SidebarSimple';
import { CaretDown } from '@phosphor-icons/react/dist/ssr/CaretDown';
import { CaretLeft } from '@phosphor-icons/react/dist/ssr/CaretLeft';
import { CaretRight } from '@phosphor-icons/react/dist/ssr/CaretRight';
import { ArrowUp } from '@phosphor-icons/react/dist/ssr/ArrowUp';
import { At } from '@phosphor-icons/react/dist/ssr/At';
import { Paperclip } from '@phosphor-icons/react/dist/ssr/Paperclip';
import { Cube } from '@phosphor-icons/react/dist/ssr/Cube';
import { SlidersHorizontal } from '@phosphor-icons/react/dist/ssr/SlidersHorizontal';
import { SquaresFour } from '@phosphor-icons/react/dist/ssr/SquaresFour';
import { Pause } from '@phosphor-icons/react/dist/ssr/Pause';
import { Play } from '@phosphor-icons/react/dist/ssr/Play';
import { ArrowLeft } from '@phosphor-icons/react/dist/ssr/ArrowLeft';
import { X } from '@phosphor-icons/react/dist/ssr/X';
import { MagnifyingGlass } from '@phosphor-icons/react/dist/ssr/MagnifyingGlass';
import type { IconWeight } from '@phosphor-icons/react';

const icons = { folder: FolderOpen, production: FilmSlate, agent: Sparkle, finish: PlaySquare, tasks: ClipboardText,
  settings: GearSix, plus: Plus, arrow: ArrowUpRight, image: ImageSquare, clock: Clock, canvas: Selection,
  sidebar: SidebarSimple, down: CaretDown, left: CaretLeft, right: CaretRight, send: ArrowUp, at: At,
  attach: Paperclip, model: Cube, preferences: SlidersHorizontal, skills: SquaresFour, pause: Pause,
  play: Play, back: ArrowLeft, close: X, search: MagnifyingGlass };
export type IconName = keyof typeof icons;
const filled = new Set<IconName>(['folder','production','agent','finish','tasks','settings']);
export function Icon({ name, size = 20, weight }: { name: IconName; size?: number; weight?: IconWeight }) {
  const Glyph = icons[name];
  return <Glyph size={size} weight={weight ?? (filled.has(name) ? 'fill' : 'regular')} aria-hidden="true" />;
}