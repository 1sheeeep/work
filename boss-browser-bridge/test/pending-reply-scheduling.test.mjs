import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../src/content.js', import.meta.url), 'utf8');
const start = source.indexOf('  function rememberPendingReply(');
const helper = source.slice(start, source.indexOf('\n  async function nextReadyInboundReply(', start));
function fixture() {
  const tasks = new Map();
  const lanes = [];
  const remember = runInNewContext(`${helper}\nrememberPendingReply`, {
    singleAccountPendingReplies: tasks,
    enqueuePipelineTask: (id, lane) => lanes.push([id, lane]),
  });
  return { tasks, lanes, remember };
}
const snapshot = { chatDigest: 'chat', messageDigest: 'message' };

test('repeated recovery cannot postpone polling or reset task state', () => {
  const f = fixture();
  const task = f.remember({ taskId: 'task' }, snapshot, 'row', 1000);
  assert.equal(task.nextPollAt, 1500);
  task.locateFailures = 2;
  for (const now of [1100, 1300, 1499, 1600]) {
    assert.equal(f.remember({ taskId: 'task', recovered: true }, snapshot, 'row', now), task);
    assert.equal(task.nextPollAt, 1500);
    assert.equal(task.locateFailures, 2);
  }
  assert.equal(f.lanes.length, 1);
  assert.ok(task.nextPollAt <= 1600);
});

test('newly recovered backend task is immediately eligible for polling', () => {
  const f = fixture();
  assert.equal(f.remember({ taskId: 'recovered', recovered: true }, snapshot, null, 1000).nextPollAt, 0);
});

test('existing message guard precedes analysis request and retains the deadline', () => {
  const start = source.indexOf("traceAutoReply('AI_EXISTING_TASK_WAITING'");
  const end = source.indexOf("traceAutoReply('AI_REQUESTED'", start);
  assert.ok(start > 0 && end > start);
  const guard = source.slice(start, end);
  assert.match(guard, /return scheduleSingleAccountAutoReply/);
  assert.match(guard, /pending.nextPollAt/);
  assert.doesNotMatch(guard, /nextPollAt\s*=/);
});
