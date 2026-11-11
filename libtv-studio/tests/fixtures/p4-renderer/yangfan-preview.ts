import './main.tsx';
import {previewData} from './yangfan-preview-data.ts';
// This isolated fixture never connects to the local engine or a model provider.
await window.p4Fixture.mount(previewData);