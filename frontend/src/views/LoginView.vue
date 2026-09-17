<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { FormInstance, FormRules } from 'element-plus'
import { Lock, User } from '@element-plus/icons-vue'
import { authStore } from '../stores/auth'
import { apiErrorMessage } from '../services/api'
import LoginParticles from '../components/LoginParticles.vue'

const router = useRouter()
const route = useRoute()
const formRef = ref<FormInstance>()
const loading = ref(false)
const submitError = ref('')
const isLeaving = ref(false)
const isHrPortal = computed(() => route.name === 'hr-login')
const portalTitle = computed(() => isHrPortal.value ? 'HR 登录' : '系统管理员登录')
const portalDescription = computed(() => isHrPortal.value ? '使用公司分配的 HR 账号进入工作台。' : '使用系统管理员账号进入工作台。')
const alternatePortalLabel = computed(() => isHrPortal.value ? '切换到系统管理员登录' : '切换到 HR 登录')
const form = reactive({ username: '', password: '', rememberMe: false })
const rules: FormRules<typeof form> = {
  username: [{ required: true, message: '请输入用户名', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }],
}

watch(isHrPortal, () => {
  submitError.value = ''
  formRef.value?.resetFields()
})

function onCardMove(e: MouseEvent) {
  const el = e.currentTarget as HTMLElement
  const r = el.getBoundingClientRect()
  el.style.setProperty('--mx', `${e.clientX - r.left}px`)
  el.style.setProperty('--my', `${e.clientY - r.top}px`)
}

function onCardLeave(e: MouseEvent) {
  const el = e.currentTarget as HTMLElement
  el.style.removeProperty('--mx')
  el.style.removeProperty('--my')
}

function onBtnMove(e: MouseEvent) {
  const el = e.currentTarget as HTMLElement
  const r = el.getBoundingClientRect()
  el.style.setProperty('--btn-x', `${(e.clientX - r.left - r.width / 2) * 0.12}px`)
  el.style.setProperty('--btn-y', `${(e.clientY - r.top - r.height / 2) * 0.12}px`)
}

function onBtnLeave(e: MouseEvent) {
  const el = e.currentTarget as HTMLElement
  el.style.removeProperty('--btn-x')
  el.style.removeProperty('--btn-y')
}

async function submit() {
  submitError.value = ''
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  loading.value = true
  try {
    await authStore.login(form.username, form.password, form.rememberMe)
    isLeaving.value = true
    await new Promise(r => setTimeout(r, 480))
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/dashboard'
    await router.replace(redirect)
  } catch (error) {
    submitError.value = apiErrorMessage(error, '登录失败，请检查服务状态后重试')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <main class="login-page" :class="{ 'is-leaving': isLeaving }">
    <div class="login-scene" aria-hidden="true">
      <LoginParticles />
      <span class="scene-ribbon scene-ribbon--one"></span>
      <span class="scene-ribbon scene-ribbon--two"></span>
      <span class="scene-ribbon scene-ribbon--three"></span>
      <span class="scene-ribbon scene-ribbon--four"></span>
    </div>
    <section class="login-brand" aria-labelledby="brand-title">
      <div class="brand-facets" aria-hidden="true">
        <span class="brand-facets__facet brand-facets__facet--one"></span>
        <span class="brand-facets__facet brand-facets__facet--two"></span>
        <span class="brand-facets__facet brand-facets__facet--three"></span>
        <span class="brand-facets__facet brand-facets__facet--four"></span>
      </div>
      <div class="brand-stage">
        <p class="brand-kicker">招聘运营工作台</p>
        <h1 id="brand-title" class="brand-wordmark">招聘值守台</h1>
        <p class="brand-description">统一接待招聘消息，查看简历分析，让每一次跟进都有迹可循。</p>
        <div class="brand-status"><span class="brand-status__dot" aria-hidden="true"></span><span>安全连接</span><span class="brand-status__separator" aria-hidden="true">·</span><span>人工确认边界</span></div>
      </div>
    </section>

    <section class="login-panel" aria-labelledby="login-title">
      <div class="login-shell">
        <div class="login-card" @mousemove="onCardMove" @mouseleave="onCardLeave">
          <div class="login-card__topline">
            <span class="login-card__eyebrow">招聘值守台</span>
          </div>
          <div class="login-heading">
            <h2 id="login-title">{{ portalTitle }}</h2>
            <p>{{ portalDescription }}</p>
          </div>
          <el-alert v-if="submitError" :title="submitError" type="error" :closable="false" show-icon role="alert" class="login-alert" />
          <el-form ref="formRef" :model="form" :rules="rules" label-position="top" @submit.prevent="submit">
            <el-form-item label="用户名" prop="username">
              <el-input v-model="form.username" :prefix-icon="User" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="请输入系统用户名" autofocus :validate-event="false" />
            </el-form-item>
            <el-form-item label="密码" prop="password">
              <el-input v-model="form.password" :prefix-icon="Lock" type="password" autocomplete="current-password" placeholder="请输入密码" show-password :validate-event="false" @keyup.enter="submit" />
            </el-form-item>
            <div class="login-options">
              <el-checkbox v-model="form.rememberMe">保持登录 7 天</el-checkbox>
              <router-link :to="isHrPortal ? '/login' : '/hr-login'" :aria-label="alternatePortalLabel">{{ alternatePortalLabel }}</router-link>
            </div>
            <el-button type="primary" native-type="submit" :loading="loading" :aria-busy="loading" class="login-submit" @mousemove="onBtnMove" @mouseleave="onBtnLeave"><span>{{ loading ? '正在验证…' : '登录' }}</span></el-button>
          </el-form>
          <p class="security-note">会话默认保持 8 小时，勾选后保持登录 7 天。</p>
        </div>
      </div>
    </section>
  </main>
</template>

<style scoped>
@property --aurora-angle {
  syntax: '<angle>';
  initial-value: 135deg;
  inherits: false;
}

.login-page {
  position: relative;
  display: grid;
  min-height: 100dvh;
  place-items: center;
  grid-template-columns: 1fr;
  overflow: hidden;
  isolation: isolate;
  animation: aurora-shift 20s ease-in-out infinite;
  background:
    radial-gradient(circle at 76% 16%, rgba(45, 212, 191, .18), transparent 29%),
    radial-gradient(circle at 18% 82%, rgba(20, 184, 166, .2), transparent 34%),
    linear-gradient(var(--aurora-angle), #062f3c 0%, #082a3b 48%, #071f2b 100%);
}

.login-scene {
  position: absolute;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  pointer-events: none;
}

.login-scene::before {
  content: '';
  position: absolute;
  inset: 0;
  opacity: .35;
  background:
    repeating-radial-gradient(circle at 28% 72%, transparent 0px, transparent 48px, rgba(94, 234, 212, .035) 48px, rgba(94, 234, 212, .035) 49px, transparent 49px, transparent 96px),
    repeating-radial-gradient(circle at 74% 22%, transparent 0px, transparent 56px, rgba(45, 212, 191, .028) 56px, rgba(45, 212, 191, .028) 57px, transparent 57px, transparent 112px);
  mask-image: linear-gradient(135deg, transparent 8%, #000 40%, #000 60%, transparent 92%);
  animation: contour-pulse 12s ease-in-out infinite, contour-breathe 8s ease-in-out infinite;
}

.login-scene::after {
  content: '';
  position: absolute;
  inset: 0;
  opacity: .18;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='56' height='100'%3E%3Cpath d='M28 66L0 50V16L28 0l28 16v34L28 66zm0 34L0 84V50l28-16 28 16v34L28 100z' fill='none' stroke='%235eead4' stroke-width='.4' opacity='.35'/%3E%3C/svg%3E");
  background-size: 56px 100px;
  mask-image: linear-gradient(315deg, transparent 15%, #000 50%, transparent 85%);
  animation: hex-drift 30s linear infinite;
}

.login-page::before {
  content: '';
  position: absolute;
  inset: -18%;
  z-index: -1;
  pointer-events: none;
  background:
    linear-gradient(122deg,
      transparent 0 42%,
      rgba(94, 234, 212, .06) 42.2% 43%,
      transparent 43.2% 58%,
      rgba(94, 234, 212, .04) 58.2% 59%,
      transparent 59.2% 74%,
      rgba(94, 234, 212, .03) 74.2% 75%,
      transparent 75.2%
    );
  background-size: 300% 100%;
  transform: rotate(-4deg);
  animation: data-flow 10s linear infinite;
}

.scene-ribbon {
  position: absolute;
  display: block;
  border-radius: 40% 60% 55% 45% / 55% 45% 60% 40%;
  filter: blur(22px);
  pointer-events: none;
  animation: ribbon-morph 16s ease-in-out infinite;
}

.scene-ribbon--one {
  top: 8%; right: 5%; width: clamp(180px, 22vw, 360px); height: clamp(90px, 11vw, 180px);
  background: radial-gradient(ellipse at 40% 40%, rgba(45, 212, 191, .18), rgba(20, 184, 166, .06) 50%, transparent 72%);
  opacity: .7;
  animation-delay: 0s;
}

.scene-ribbon--two {
  bottom: 10%; left: 3%; width: clamp(220px, 26vw, 420px); height: clamp(80px, 10vw, 160px);
  background: radial-gradient(ellipse at 60% 50%, rgba(94, 234, 212, .14), rgba(45, 212, 191, .05) 45%, transparent 68%);
  opacity: .6;
  animation-delay: 4s;
}

.scene-ribbon--three {
  top: 38%; left: 18%; width: clamp(140px, 16vw, 280px); height: clamp(60px, 7vw, 120px);
  background: radial-gradient(ellipse at 50% 50%, rgba(153, 246, 228, .12), rgba(94, 234, 212, .04) 40%, transparent 65%);
  opacity: .5;
  animation-delay: 8s;
}

.scene-ribbon--four {
  bottom: 30%; right: 12%; width: clamp(160px, 18vw, 300px); height: clamp(70px, 8vw, 140px);
  background: radial-gradient(ellipse at 35% 55%, rgba(45, 212, 191, .1), rgba(20, 184, 166, .04) 48%, transparent 70%);
  opacity: .45;
  animation-delay: 12s;
}

.login-brand {
  position: absolute;
  inset: 0;
  z-index: 0;
  display: block;
  overflow: hidden;
  padding: 0;
  isolation: isolate;
  background: rgba(4, 35, 47, .18);
  color: #fff;
  pointer-events: none;
}

.login-brand::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -1;
  background: radial-gradient(circle at 74% 10%, rgba(45, 212, 191, .13), transparent 30%), radial-gradient(circle at 24% 84%, rgba(20, 184, 166, .14), transparent 34%), linear-gradient(180deg, rgba(255, 255, 255, .035), transparent 50%);
  pointer-events: none;
}

.login-brand::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -1;
  background-image: linear-gradient(120deg, transparent 0 48%, rgba(255, 255, 255, .035) 48.2% 49%, transparent 49.2%), linear-gradient(35deg, transparent 0 62%, rgba(255, 255, 255, .028) 62.2% 63%, transparent 63.2%);
  mask-image: linear-gradient(135deg, rgba(0, 0, 0, .94), transparent 84%);
  pointer-events: none;
}

.brand-facets { position: absolute; inset: 0; pointer-events: none; }
.brand-facets__facet { position: absolute; display: block; opacity: .8; transform-origin: center; filter: blur(8px); border-radius: 40% 60% 55% 45% / 55% 45% 60% 40%; animation: facet-drift 18s ease-in-out infinite, ribbon-morph 16s ease-in-out infinite; }
.brand-facets__facet--one { inset: -16% auto auto -10%; width: 64%; height: 74%; background: linear-gradient(138deg, rgba(45, 212, 191, .38), rgba(20, 184, 166, .12)); clip-path: polygon(0 0, 74% 0, 100% 52%, 55% 100%, 0 74%); }
.brand-facets__facet--two { top: -8%; right: -12%; width: 60%; height: 68%; background: linear-gradient(148deg, rgba(20, 184, 166, .36), rgba(45, 212, 191, .22)); clip-path: polygon(28% 0, 100% 0, 100% 78%, 50% 100%, 0 48%); animation-delay: 4s, 4s; }
.brand-facets__facet--three { right: -14%; bottom: -17%; width: 72%; height: 64%; background: linear-gradient(138deg, rgba(45, 212, 191, .26), rgba(20, 184, 166, .38)); clip-path: polygon(48% 0, 100% 38%, 100% 100%, 0 100%, 0 62%); animation-delay: 8s, 8s; }
.brand-facets__facet--four { bottom: -13%; left: -16%; width: 66%; height: 52%; background: linear-gradient(145deg, rgba(45, 212, 191, .22), rgba(20, 184, 166, .42)); clip-path: polygon(0 0, 54% 0, 100% 74%, 100% 100%, 0 100%); animation-delay: 12s, 12s; }

.brand-stage {
  position: absolute;
  top: clamp(30px, 8vh, 92px);
  left: clamp(24px, 8vw, 140px);
  display: grid;
  justify-items: start;
  width: min(360px, calc(100% - 48px));
  gap: 14px;
  text-align: left;
}

.brand-kicker { margin: 0; color: rgba(153, 246, 228, .76); font-size: 12px; font-weight: 700; letter-spacing: .12em; }

.brand-wordmark { margin: 0; color: rgba(255, 255, 255, .94); font-size: clamp(26px, 3vw, 42px); font-weight: 720; letter-spacing: .1em; text-shadow: 0 8px 28px rgba(0, 0, 0, .22); animation: brand-wordmark-arrive 650ms cubic-bezier(.16, 1, .3, 1) 250ms both; }
.brand-description { max-width: 390px; margin: -6px 0 0; color: rgba(226, 232, 240, .7); font-size: 14px; line-height: 1.75; }
.brand-status { display: inline-flex; align-items: center; gap: 8px; margin-top: 2px; padding: 8px 13px; border: 1px solid rgba(153, 246, 228, .18); border-radius: var(--radius-pill); background: rgba(5, 21, 33, .28); color: rgba(226, 232, 240, .68); font-size: 11px; letter-spacing: .02em; backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); }
.brand-status__dot { width: 6px; height: 6px; flex: 0 0 auto; border-radius: 50%; background: #5eead4; box-shadow: 0 0 0 4px rgba(94, 234, 212, .12); animation: pulse-dot 2s ease-in-out infinite; }
.brand-status__separator { color: rgba(226, 232, 240, .32); }

.login-panel { position: relative; z-index: 1; grid-area: 1 / 1; display: grid; place-items: center; width: 100%; min-height: 100dvh; min-width: 0; padding: 48px; isolation: isolate; background: rgba(3, 27, 39, .12); }
.login-panel::before { content: ''; position: absolute; inset: 0; z-index: -1; background: radial-gradient(circle at 78% 10%, rgba(45, 212, 191, .1), transparent 32%), radial-gradient(circle at 16% 92%, rgba(30, 136, 148, .11), transparent 28%); pointer-events: none; }
.login-shell { display: grid; justify-items: center; width: min(100%, 420px); }
.login-card { position: relative; overflow: hidden; width: min(100%, 420px); padding: 38px 38px 30px; border: 1px solid rgba(205, 255, 246, .24); border-radius: 24px; background: rgba(17, 48, 63, .46); backdrop-filter: blur(30px) saturate(150%); -webkit-backdrop-filter: blur(30px) saturate(150%); box-shadow: 0 30px 78px rgba(0, 9, 18, .38), inset 0 1px 0 rgba(255, 255, 255, .17), inset 0 -1px 0 rgba(45, 212, 191, .1); animation: card-arrive 600ms cubic-bezier(.16, 1, .3, 1) 80ms both; }
.login-card::before { content: ''; position: absolute; inset: 0; background: radial-gradient(320px circle at var(--mx, 50%) var(--my, 50%), rgba(94, 234, 212, .08), transparent 60%); pointer-events: none; transition: background 80ms ease; }
.login-card::after { content: ''; position: absolute; top: -34%; right: -28%; width: 260px; height: 180px; border-radius: 50%; background: radial-gradient(circle, rgba(126, 246, 224, .14), transparent 68%); filter: blur(8px); pointer-events: none; }
.login-card > * { position: relative; z-index: 1; }

@supports not (backdrop-filter: blur(1px)) {
  .login-card { background: #14384a; }
}

.login-card__topline { display: flex; align-items: center; gap: 12px; margin-bottom: 18px; }
.login-card__topline::after { content: ''; width: 42px; height: 1px; background: linear-gradient(90deg, rgba(121, 234, 213, .65), transparent); }
.login-card__eyebrow { color: #8af4df; font-size: 12px; font-weight: 750; letter-spacing: .04em; }
.login-heading h2 { margin: 0 0 10px; color: #f2fbfa; font-size: clamp(24px, 2.2vw, 30px); letter-spacing: -.03em; line-height: 1.2; }
.login-heading p { max-width: 34ch; margin: 0 0 28px; color: rgba(219, 239, 241, .72); font-size: 14px; line-height: 1.65; }
.login-alert { margin-bottom: 18px; --el-alert-bg-color: rgba(180, 57, 57, .16); --el-alert-border-color: rgba(248, 113, 113, .3); --el-alert-text-color: #fecaca; animation: shake 300ms ease-out; }
.login-card :deep(.el-form-item__label) { color: rgba(226, 241, 241, .84); }
.login-card :deep(.el-input__wrapper) { background: rgba(4, 24, 36, .34); box-shadow: 0 0 0 1px rgba(205, 255, 246, .2) inset, 0 3px 10px rgba(0, 9, 18, .12); transition: box-shadow 180ms ease, background-color 180ms ease; }
.login-card :deep(.el-input__wrapper:hover) { background: rgba(4, 24, 36, .46); box-shadow: 0 0 0 1px rgba(205, 255, 246, .4) inset, 0 4px 14px rgba(0, 9, 18, .18); }
.login-card :deep(.el-input__wrapper.is-focus) { background: rgba(4, 24, 36, .5); box-shadow: 0 0 0 1px #72ead6 inset, 0 0 0 3px rgba(114, 234, 214, .16), 0 5px 16px rgba(0, 9, 18, .2); animation: focus-glow 2s ease-in-out infinite; }
.login-card :deep(.el-input__inner) { color: #f2fbfa; caret-color: #5eead4; }
.login-card :deep(.el-input__inner::placeholder) { color: rgba(196, 216, 219, .56); }
.login-card :deep(.el-input__prefix-inner), .login-card :deep(.el-input__suffix-inner) { color: rgba(196, 225, 224, .66); }
.login-card :deep(.el-form-item__error) { color: #f2a3a3; }
.login-card :deep(.el-input__wrapper.is-error) { box-shadow: 0 0 0 1px rgba(248, 113, 113, .68) inset, 0 2px 8px rgba(0, 0, 0, .16); }
.login-card :deep(.el-checkbox__label) { color: rgba(226, 241, 241, .78); }
.login-card :deep(.el-checkbox__inner) { background: rgba(3, 18, 28, .42); border-color: rgba(153, 246, 228, .34); }
.login-card :deep(.el-checkbox__input.is-checked .el-checkbox__inner) { background: #168f85; border-color: #54d4c0; }
.login-card :deep(.el-checkbox__input.is-checked + .el-checkbox__label) { color: #e5fffa; }
.login-options { display: flex; align-items: center; justify-content: space-between; gap: 14px; margin: -2px 0 16px; font-size: 13px; }
.login-options a { color: #79ead5; font-weight: 700; text-decoration: none; transition: color var(--transition-fast); }
.login-options a:hover { text-decoration: underline; }
.login-options a:focus-visible { outline: 3px solid color-mix(in srgb, var(--border-focus) 42%, transparent); outline-offset: 3px; border-radius: 4px; }
.login-submit { width: 100%; min-height: 40px; margin-top: 4px; border: 0; border-radius: var(--radius-pill); background-image: linear-gradient(90deg, #58b990 0%, #158d82 40%, #6dd8b4 50%, #158d82 60%, #58b990 100%); background-size: 200% 100%; box-shadow: 0 8px 16px rgba(13, 148, 136, .17); animation: btn-shimmer 3s ease-in-out infinite; transform: translate(var(--btn-x, 0), var(--btn-y, 0)); transition: transform 150ms ease-out, box-shadow var(--transition-fast), filter var(--transition-fast); }
.login-submit:hover:not(.is-disabled) { filter: saturate(1.06) brightness(1.02); box-shadow: 0 14px 24px rgba(13, 148, 136, .22); }
.login-submit:active:not(.is-disabled) { transform: translate(var(--btn-x, 0), var(--btn-y, 0)) scale(.99); }
.security-note { margin: 18px 0 0; color: rgba(190, 214, 217, .64); font-size: 12px; line-height: 1.6; text-align: center; }

@keyframes card-arrive { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
@keyframes brand-wordmark-arrive { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
@keyframes ribbon-morph {
  0%   { border-radius: 40% 60% 55% 45% / 55% 45% 60% 40%; }
  25%  { border-radius: 55% 45% 40% 60% / 45% 60% 55% 40%; }
  50%  { border-radius: 60% 40% 45% 55% / 40% 55% 45% 60%; }
  75%  { border-radius: 45% 55% 60% 40% / 60% 40% 55% 45%; }
  100% { border-radius: 40% 60% 55% 45% / 55% 45% 60% 40%; }
}
@keyframes contour-pulse { 0%, 100% { opacity: .3; } 50% { opacity: .45; } }
@keyframes contour-breathe { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.02); } }
@keyframes hex-drift { 0% { background-position: 0 0; } 100% { background-position: 56px 100px; } }
@keyframes data-flow { 0% { background-position: 0% 0; } 100% { background-position: 300% 0; } }
@keyframes facet-drift { 0%, 100% { transform: rotate(0deg) scale(1); } 50% { transform: rotate(0.5deg) scale(1.01); } }
@keyframes aurora-shift { 0%, 100% { --aurora-angle: 135deg; } 50% { --aurora-angle: 155deg; } }
@keyframes btn-shimmer { 0% { background-position: 100% 0; } 100% { background-position: -100% 0; } }
@keyframes pulse-dot { 0%, 100% { box-shadow: 0 0 0 4px rgba(94, 234, 212, .12); } 50% { box-shadow: 0 0 0 8px rgba(94, 234, 212, .24); } }
@keyframes focus-glow { 0%, 100% { box-shadow: 0 0 0 1px #72ead6 inset, 0 0 0 3px rgba(114, 234, 214, .16), 0 5px 16px rgba(0, 9, 18, .2); } 50% { box-shadow: 0 0 0 1px #72ead6 inset, 0 0 0 5px rgba(114, 234, 214, .24), 0 5px 16px rgba(0, 9, 18, .2); } }
@keyframes shake { 0%, 100% { transform: translateX(0); } 20% { transform: translateX(-4px); } 40% { transform: translateX(4px); } 60% { transform: translateX(-3px); } 80% { transform: translateX(3px); } }
@keyframes page-exit { to { opacity: 0; transform: scale(1.04); filter: blur(6px); } }

.login-page.is-leaving { animation: page-exit 480ms cubic-bezier(.16, 1, .3, 1) forwards; }

@media (max-width: 900px) {
  .login-page { grid-template-columns: 1fr; }
  .login-brand { min-height: 0; padding: 0; }
  .brand-stage { top: 28px; right: 24px; left: 24px; justify-items: center; width: auto; gap: 10px; text-align: center; }
  .brand-kicker { font-size: 11px; }
  .brand-wordmark { font-size: 30px; }
  .brand-description { max-width: 330px; font-size: 13px; }
  .login-panel { place-items: start center; min-height: 100dvh; padding: 168px 16px 40px; }
  .login-card { padding: 30px 22px 26px; }
}

@media (max-width: 460px) {
  .login-options { align-items: flex-start; flex-direction: column; gap: 8px; }
  .brand-stage { top: 22px; right: 20px; left: 20px; }
  .brand-description { max-width: 290px; }
  .brand-status { font-size: 10px; }
  .login-card { padding: 24px 18px; }
}

:global(:root[data-theme="dark"]) .login-page { background: radial-gradient(circle at 76% 16%, rgba(45, 212, 191, .12), transparent 29%), radial-gradient(circle at 18% 82%, rgba(20, 184, 166, .14), transparent 34%), linear-gradient(135deg, #041f2c 0%, #061c2a 48%, #04151e 100%); }
:global(:root[data-theme="dark"]) .login-scene::before { opacity: .25; background: repeating-radial-gradient(circle at 28% 72%, transparent 0px, transparent 48px, rgba(94, 234, 212, .025) 48px, rgba(94, 234, 212, .025) 49px, transparent 49px, transparent 96px), repeating-radial-gradient(circle at 74% 22%, transparent 0px, transparent 56px, rgba(45, 212, 191, .02) 56px, rgba(45, 212, 191, .02) 57px, transparent 57px, transparent 112px); }
:global(:root[data-theme="dark"]) .login-scene::after { opacity: .12; }
:global(:root[data-theme="dark"]) .login-page::before { background: linear-gradient(122deg, transparent 0 42%, rgba(94, 234, 212, .04) 42.2% 43%, transparent 43.2% 58%, rgba(94, 234, 212, .03) 58.2% 59%, transparent 59.2% 74%, rgba(94, 234, 212, .02) 74.2% 75%, transparent 75.2%); }
:global(:root[data-theme="dark"]) .scene-ribbon--one { opacity: .5; }
:global(:root[data-theme="dark"]) .scene-ribbon--two { opacity: .4; }
:global(:root[data-theme="dark"]) .scene-ribbon--three { opacity: .35; }
:global(:root[data-theme="dark"]) .scene-ribbon--four { opacity: .3; }
:global(:root[data-theme="dark"]) .login-panel { background: rgba(1, 16, 25, .14); }
:global(:root[data-theme="dark"]) .login-panel::before { background: radial-gradient(circle at 78% 10%, rgba(45, 212, 191, .13), transparent 32%), radial-gradient(circle at 16% 92%, rgba(30, 136, 148, .11), transparent 28%); }
:global(:root[data-theme="dark"]) .login-card { border-color: rgba(205, 255, 246, .22); background: rgba(4, 25, 37, .54); box-shadow: 0 30px 76px rgba(0, 0, 0, .44), inset 0 1px 0 rgba(255, 255, 255, .12), inset 0 -1px 0 rgba(45, 212, 191, .07); }
:global(:root[data-theme="dark"]) .login-card::before { background: radial-gradient(320px circle at var(--mx, 50%) var(--my, 50%), rgba(94, 234, 212, .06), transparent 60%); }
:global(:root[data-theme="dark"]) .login-card__eyebrow { color: #72ead6; }

@media (prefers-reduced-motion: reduce) {
  .brand-wordmark, .login-card, .login-submit, .login-card :deep(.el-input__wrapper),
  .scene-ribbon, .login-page::before,
  .brand-facets__facet, .login-scene::before, .login-scene::after,
  .brand-status__dot, .login-page, .login-alert,
  .login-card :deep(.el-input__wrapper.is-focus) {
    animation: none !important;
    transition: none !important;
  }
  .login-submit { background-position: 0 0; transform: none; }
  .login-page::before { background-position: 0 0; }
  .login-scene::after { background-position: 0 0; }
}
</style>