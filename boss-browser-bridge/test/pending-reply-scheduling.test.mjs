import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../src/content.js', import.meta.url), 'utf8');
const start = source.indexOf('  function resetPipelineQueues(');
const helper = source.slice(start, source.indexOf('\n  async function nextReadyInboundReply(', start));
function fixture() {
  const tasks = new Map();
  const context = {
    singleAccountPendingReplies: tasks,
    singleAccountPipelineQueue: [],
    singleAccountCurrentTaskId: null,
    singleAccountPendingChatDigest: null,
    PIPELINE_LANE_PRIORITY: { SEND: 0, ANALYSIS: 1, REVALIDATION: 2 },
  };
  const remember = runInNewContext(`${helper}\nrememberPendingReply`, context);
  return { tasks, context, remember };
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
  assert.equal(f.context.singleAccountPipelineQueue.length, 1);
  assert.ok(task.nextPollAt <= 1600);
});

test('newly recovered backend task is immediately eligible for polling', () => {
  const f = fixture();
  assert.equal(f.remember({ taskId: 'recovered', recovered: true }, snapshot, null, 1000).nextPollAt, 0);
});

test('page scheduler keeps one current task even when recovery returns more work', () => {
  const f = fixture();
  f.remember({ taskId: 'first' }, snapshot, 'row-1', 1000);
  f.remember({ taskId: 'second' }, { chatDigest: 'chat-2', messageDigest: 'message-2' }, 'row-2', 1000);
  assert.equal(f.tasks.size, 2);
  assert.equal(f.context.singleAccountCurrentTaskId, 'first');
  assert.deepEqual(f.context.singleAccountPipelineQueue.map(item => item.taskId), ['first']);
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
