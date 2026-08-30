import test from 'node:test';
import assert from 'node:assert/strict';
import { isJobManagementUrl, jobSnapshotSignature, publicStatus, snapshotSignature, validateBackendUrl, validateJobSnapshot, validateSnapshot } from '../src/bridge-core.mjs';

const digest = 'a'.repeat(64);
const digest2 = 'b'.repeat(64);

test('only accepts the local recruitment console URL', () => {
  assert.equal(validateBackendUrl('http://localhost:8088/'), 'http://localhost:8088');
  assert.equal(validateBackendUrl('http://127.0.0.1:8088'), 'http://127.0.0.1:8088');
  assert.throws(() => validateBackendUrl('https://example.com'), /只允许/);
});

test('recognizes the real BOSS job management route without confusing chat pages', () => {
  assert.equal(isJobManagementUrl('https://zhipin.com/web/chat/job/list'), true);
  assert.equal(isJobManagementUrl('https://www.zhipin.com/web/chat/job/list/'), true);
  assert.equal(isJobManagementUrl('https://zhipin.com/web/chat/index'), false);
  assert.equal(isJobManagementUrl('https://zhipin.com/web/chat/user-center'), false);
});

test('accepts a minimized unread snapshot and selected direction', () => {
  const payload = { pageState: 'CHAT_PAGE_READY', entries: [{ chatDigest: digest, previewDigest: digest2, jobDigest: null, jobTitle: null, timeDigest: null, unreadCount: 2 }], selected: { chatDigest: digest, messageDigest: digest2, direction: 'INBOUND', messageAt: '2026-08-30T08:00:00.000Z', selectedUnread: true, observedAt: '2026-08-30T08:00:01.000Z' } };
  assert.equal(validateSnapshot(payload), payload);
  assert.match(snapshotSignature(payload), /^a{64}:2:/);
});

test('binds selected detail to the current list and includes it in deduplication', () => {
  const entry = { chatDigest: digest, previewDigest: null, jobDigest: null, jobTitle: null, timeDigest: null, unreadCount: 1 };
  const selected = { chatDigest: digest, messageDigest: digest2, direction: 'INBOUND', messageAt: '2026-08-30T08:00:00.000Z', selectedUnread: false, observedAt: '2026-08-30T08:00:01.000Z' };
  const first = { pageState: 'CHAT_PAGE_READY', entries: [entry], selected };
  const changed = { ...first, selected: { ...selected, direction: 'OUTBOUND' } };
  assert.notEqual(snapshotSignature(first), snapshotSignature(changed));
  assert.throws(() => validateSnapshot({ ...first, selected: { ...selected, chatDigest: 'c'.repeat(64) } }), /不属于/);
  assert.equal(validateSnapshot({ ...first, detailStatus: { code: 'VERIFIED', reason: '当前会话详情已稳定识别。' } }).detailStatus.code, 'VERIFIED');
  assert.throws(() => validateSnapshot({ ...first, detailStatus: { code: 'bad code', reason: '候选人原文' } }), /状态无效/);
});

test('rejects duplicate identities and raw or malformed values', () => {
  const entry = { chatDigest: digest, previewDigest: null, jobDigest: null, jobTitle: null, timeDigest: null, unreadCount: 1 };
  assert.throws(() => validateSnapshot({ pageState: 'CHAT_PAGE_READY', entries: [entry, entry] }), /重复/);
  assert.throws(() => validateSnapshot({ pageState: 'CHAT_PAGE_READY', entries: [{ ...entry, previewDigest: '候选人消息原文' }] }), /摘要无效/);
});

test('public status never exposes the local device token and keeps legacy counters compatible', () => {
  const status = publicStatus({ deviceToken: 'secret-device-token', accountName: '主账号', enabled: true }, { state: 'RUNNING', unread: 5 });
  assert.equal(status.paired, true);
  assert.equal(status.accountName, '主账号');
  assert.equal(status.currentUnread, 5);
  assert.equal(status.trackedUnread, 5);
  assert.equal(status.detailState, '尚未复核当前会话详情。');
  assert.equal('deviceToken' in status, false);
});

test('accepts minimized job snapshots and rejects duplicate or raw source identities', () => {
  const entry = { sourceDigest: digest, title: 'Java 开发工程师', location: '上海·徐汇', salaryDisplay: '20-30K·13薪', salaryMinK: 20, salaryMaxK: 30, salaryMonths: 13, experienceRequirement: '3-5年', educationRequirement: '本科', description: null, completeness: 5 };
  const payload = { pageState: 'JOB_MANAGEMENT_READY', entries: [entry], observedAt: '2026-08-30T08:00:00.000Z' };
  assert.equal(validateJobSnapshot(payload), payload);
  assert.match(jobSnapshotSignature(payload), /^a{64}:Java 开发工程师:/);
  assert.throws(() => validateJobSnapshot({ ...payload, entries: [entry, entry] }), /重复/);
  assert.throws(() => validateJobSnapshot({ ...payload, entries: [{ ...entry, sourceDigest: 'raw-platform-id' }] }), /摘要无效/);
});

test('accepts unified visible job detail fields', () => {
  const payload = { pageState: 'JOB_MANAGEMENT_READY', observedAt: '2026-08-30T08:00:00.000Z', entries: [{
    sourceDigest: 'd'.repeat(64), title: '跨境客服主管', location: null, salaryDisplay: '8-13K',
    salaryMinK: 8, salaryMaxK: 13, salaryMonths: null, experienceRequirement: '1-3年', educationRequirement: '大专',
    description: '负责客户咨询与售后问题处理。', recruitmentType: '社会全职', jobCategory: '客服主管',
    overseasRequirement: '境内岗位', jobKeywords: '客服｜跨境电商', workAddress: '东莞中熙时代大厦22楼', completeness: 10,
  }] };
  assert.equal(validateJobSnapshot(payload), payload);
  assert.match(jobSnapshotSignature(payload), /东莞中熙时代大厦22楼/);
});
