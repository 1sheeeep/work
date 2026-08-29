<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { FormInstance, FormRules } from 'element-plus'
import { Lock, User } from '@element-plus/icons-vue'
import { authStore } from '../stores/auth'
import { apiErrorMessage } from '../services/api'

const router = useRouter()
const route = useRoute()
const formRef = ref<FormInstance>()
const loading = ref(false)
const submitError = ref('')
const form = reactive({ username: '', password: '' })
const rules: FormRules<typeof form> = {
  username: [{ required: true, message: '请输入用户名', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }],
}

async function submit() {
  submitError.value = ''
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  loading.value = true
  try {
    await authStore.login(form.username, form.password)
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
  <main class="login-page">
    <section class="login-context" aria-labelledby="product-title">
      <div class="context-inner">
        <div class="product-lockup"><span class="product-mark">招</span><span>集团 HR 内部系统</span></div>
        <h1 id="product-title">把多企业招聘账号，放进一个清晰的工作台</h1>
        <p>统一管理企业、BOSS 账号、职位、候选人会话与超时自动回复。</p>
        <dl class="context-points">
          <div><dt>集中</dt><dd>集团范围统一管理</dd></div>
          <div><dt>可控</dt><dd>能力按真实授权启用</dd></div>
          <div><dt>可追溯</dt><dd>关键操作完整留痕</dd></div>
        </dl>
      </div>
    </section>

    <section class="login-panel" aria-labelledby="login-title">
      <div class="login-card">
        <div class="login-heading">
          <span>管理员入口</span><h2 id="login-title">登录招聘控制台</h2>
          <p>使用系统账号登录，BOSS 外部账号在后续模块中独立管理。</p>
        </div>
        <el-alert v-if="submitError" :title="submitError" type="error" :closable="false" show-icon class="login-alert" />
        <el-form ref="formRef" :model="form" :rules="rules" label-position="top" @submit.prevent="submit">
          <el-form-item label="用户名" prop="username">
            <el-input v-model="form.username" :prefix-icon="User" autocomplete="username" placeholder="请输入系统用户名" autofocus />
          </el-form-item>
          <el-form-item label="密码" prop="password">
            <el-input v-model="form.password" :prefix-icon="Lock" type="password" autocomplete="current-password" placeholder="请输入密码" show-password @keyup.enter="submit" />
          </el-form-item>
          <el-button type="primary" native-type="submit" :loading="loading" class="login-submit">登录</el-button>
        </el-form>
        <p class="security-note">登录会话仅通过当前浏览器的安全 Cookie 保存。</p>
      </div>
    </section>
  </main>
</template>

<style scoped>
.login-page { display: grid; min-height: 100dvh; grid-template-columns: minmax(420px,1.08fr) minmax(420px,.92fr); background: #fff; }
.login-context { position: relative; display: grid; place-items: center; overflow: hidden; padding: 64px; background: var(--brand-950); color: #fff; }
.login-context::after { position: absolute; right: -130px; bottom: -180px; width: 420px; height: 420px; border: 1px solid rgba(94,234,212,.17); border-radius: 50%; box-shadow: 0 0 0 72px rgba(94,234,212,.035),0 0 0 144px rgba(94,234,212,.025); content: ''; }
.context-inner { position: relative; z-index: 1; width: min(100%,620px); }
.product-lockup { display: flex; align-items: center; gap: 12px; color: #c9dfdc; font-size: 14px; font-weight: 600; }
.product-mark { display: grid; width: 44px; height: 44px; place-items: center; border-radius: 11px; background: var(--brand-600); color: #fff; font-size: 20px; font-weight: 800; }
h1 { max-width: 620px; margin: 64px 0 20px; font-size: clamp(38px,4vw,58px); line-height: 1.12; letter-spacing: -.04em; }
.context-inner > p { max-width: 560px; margin: 0; color: #b8d0cc; font-size: 17px; line-height: 1.8; }
.context-points { display: grid; grid-template-columns: repeat(3,1fr); gap: 1px; margin: 64px 0 0; border: 1px solid rgba(255,255,255,.13); border-radius: 12px; background: rgba(255,255,255,.13); overflow: hidden; }
.context-points div { padding: 20px; background: var(--brand-950); }
.context-points dt { color: #5eead4; font-weight: 700; }
.context-points dd { margin: 7px 0 0; color: #a9c4c0; font-size: 13px; line-height: 1.45; }
.login-panel { display: grid; place-items: center; padding: 48px; background: #f7faf9; }
.login-card { width: min(100%,430px); padding: 40px; border: 1px solid var(--border); border-radius: 16px; background: #fff; box-shadow: 0 24px 70px rgba(15,61,58,.09); }
.login-heading > span { color: var(--brand-700); font-size: 13px; font-weight: 700; }
.login-heading h2 { margin: 10px 0; font-size: 28px; letter-spacing: -.02em; }
.login-heading p { margin: 0 0 28px; color: var(--text-secondary); font-size: 14px; line-height: 1.65; }
.login-alert { margin-bottom: 18px; }
.login-submit { width: 100%; min-height: 44px; margin-top: 4px; }
.security-note { margin: 18px 0 0; color: #71817e; font-size: 12px; line-height: 1.6; text-align: center; }
@media (max-width: 900px) {
  .login-page { grid-template-columns: 1fr; }
  .login-context { min-height: auto; place-items: start; padding: 32px 24px; }
  .context-inner { width: 100%; }
  h1 { margin: 28px 0 12px; font-size: 32px; }
  .context-inner > p, .context-points { display: none; }
  .login-panel { place-items: start center; padding: 28px 16px 48px; }
  .login-card { padding: 28px 22px; }
}
</style>
