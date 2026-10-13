import assert from 'node:assert/strict';
import { formatDuration } from '../src/lib/duration.js';

for (const [ms, label] of [[1,'1 ms'], [1500,'1.5 sec'], [10000,'10 sec'], [59600,'1 min'], [60000,'1 min'], [95000,'1 min 35 sec'], [3599600,'1 hour'], [3600000,'1 hour'], [(95*60+14)*1000,'1 hour 35 min'], [7200000,'2 hours'], [10890000,'3 hours 1 min']]) {
  assert.equal(formatDuration(ms),label);
}
for (const ms of [-1,NaN,Infinity,'invalid']) assert.equal(formatDuration(ms),'');
console.log('Duration formatting: milliseconds, seconds, minutes, hours, plurality and unit boundaries passed.');
