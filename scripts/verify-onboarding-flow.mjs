// Fast state-boundary checks. Rendered onboarding is checked separately.
import assert from 'node:assert/strict';
import { initialAgents, initialChannels, initialTasks, initialMemoryInbox, initialAutomations } from '../src/data.js';
import { chiefOfStaffMember, recommendTeammates } from '../src/lib/first-run.js';
import './check-onboarding-state.mjs';

for (const value of [initialAgents,initialChannels,initialTasks,initialMemoryInbox,initialAutomations]) assert.deepEqual(value,[]);
const chief=chiefOfStaffMember('asq_fixture',[{path:'/fixture/repository',name:'repository',needs:[]}]);
assert.equal(chief.role,'Chief of Staff'); assert.equal(chief.harness.id,'autohand');
assert.deepEqual(chief.memory,[]); assert.deepEqual(recommendTeammates([]),[]);
console.log('PASS neutral product defaults and first-install state contract (browser checks remain separate)');
