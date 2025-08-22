// @ts-ignore 
import * as NGL from '../lib/ngl.js';
import { version } from '../package.json';

console.log(`Testing ngl-data-proxy version: ${version}`);

// --- Test Bed ---
// 1. Create a stage
const stage = new NGL.Stage('viewport');

// 2. Load a structure
stage.loadFile('rcsb://1crn', { defaultRepresentation: true });

console.log('NGL Stage initialized.');

// 3. Import your component from ../src and test it here
// import { YourComponent } from '../src';
