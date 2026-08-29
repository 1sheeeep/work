<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Briefcase, ChatDotRound, Connection, OfficeBuilding, Refresh, Right, UserFilled, Warning } from '@element-plus/icons-vue'
import { api } from '../services/api'
import { authStore } from '../stores/auth'
import type { AutoReplyPolicy, BossAccount, BrowserDevice, CandidateContact, Company, JobPosition } from '../types'

const router=useRouter(),loading=ref(true),updatedAt=ref<Date|null>(null)
const companies=ref<Company[]>([]),accounts=ref<BossAccount[]>([]),jobs=ref<JobPosition[]>([]),candidates=ref<CandidateContact[]>([]),policies=ref<AutoReplyPolicy[]>([]),devices=ref<BrowserDevice[]>([])
const displayName=computed(()=>authStore.state.user?.displayName||'HR')
const metrics=computed(()=>[
 {label:'在招职位',value:jobs.value.filter(item=>item.status==='ACTIVE').length,note:`共 ${jobs.value.length} 个职位`,tone:'blue'},
 {label:'候选人',value:candidates.value.length,note:`${candidates.value.filter(item=>['NEW','SCREENING'].includes(item.status)).length} 人待处理`,tone:'violet'},
 {label:'自动跟进账号',value:policies.value.filter(item=>item.enabled&&item.autoSendEnabled).length,note:`${policies.value.filter(item=>item.pausedUntil&&new Date(item.pausedUntil)>new Date()).length} 个已暂停`,tone:'teal'},
 {label:'浏览器设备',value:devices.value.filter(item=>item.status==='ACTIVE').length,note:`${devices.value.filter(item=>item.runtimeState==='RUNNING').length} 台运行中`,tone:'orange'},
])
const attention=computed(()=>[
 ...(accounts.value.filter(item=>item.status==='ACTIVE'&&item.connectionStatus!=='CONNECTED').length?[`${accounts.value.filter(item=>item.status==='ACTIVE'&&item.connectionStatus!=='CONNECTED').length} 个 BOSS 账号连接需要检查`] : []),
 ...(devices.value.filter(item=>item.status==='ACTIVE'&&['PAUSED','OFFLINE'].includes(item.runtimeState)).length?[`${devices.value.filter(item=>item.status==='ACTIVE'&&['PAUSED','OFFLINE'].includes(item.runtimeState)).length} 台浏览器设备未正常运行`] : []),
 ...(candidates.value.filter(item=>['NEW','SCREENING'].includes(item.status)).length?[`${candidates.value.filter(item=>['NEW','SCREENING'].includes(item.status)).length} 位候选人等待筛选或复核`] : []),
])
const modules=computed(()=>[
 {route:'/job-positions',title:'职位管理',description:'维护招聘职位、要求和账号绑定',icon:Briefcase,tone:'blue',meta:`${jobs.value.filter(item=>item.status==='ACTIVE').length} 个职位在招`},
 {route:'/candidates',title:'候选人工作台',description:'集中处理筛选、会话与人工接管',icon:UserFilled,tone:'violet',meta:`${candidates.value.length} 位候选人`},
 {route:'/auto-replies',title:'自动跟进',description:'查看超时回复策略、设备与发送记录',icon:ChatDotRound,tone:'teal',meta:`${policies.value.filter(item=>item.enabled).length} 个策略启用`},
 {route:'/boss-accounts',title:'BOSS 账号',description:'管理招聘账号连接和可用能力',icon:Connection,tone:'orange',meta:`${accounts.value.filter(item=>item.connectionStatus==='CONNECTED').length} / ${accounts.value.length} 连接正常`},
 {route:'/organization',title:'企业与组织',description:'管理集团资料和企业业务范围',icon:OfficeBuilding,tone:'slate',meta:`${companies.value.filter(item=>item.status==='ACTIVE').length} 家企业启用`},
])

async function load(){loading.value=true;const requests=await Promise.allSettled([api.get<Company[]>('/organization/companies'),api.get<BossAccount[]>('/boss-accounts'),api.get<JobPosition[]>('/job-positions'),api.get<CandidateContact[]>('/candidate-contacts'),api.get<AutoReplyPolicy[]>('/auto-replies/policies'),api.get<BrowserDevice[]>('/browser-devices')]);const targets=[companies,accounts,jobs,candidates,policies,devices];requests.forEach((result,index)=>{if(result.status==='fulfilled')targets[index]!.value=result.value.data as never});updatedAt.value=new Date();loading.value=false}
function open(path:string){void router.push(path)}
function timeLabel(){return updatedAt.value?updatedAt.value.toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false}):'-'}
onMounted(load)
</script>

<template><div class="page-shell dashboard-page">
 <header class="dashboard-hero"><div><span class="eyebrow">招聘工作台</span><h1>你好，{{displayName}}</h1><p>从这里查看今天的招聘进展，并快速进入需要处理的模块。</p></div><el-button :icon="Refresh" :loading="loading" @click="load">刷新数据</el-button></header>
 <div v-if="loading" class="surface-panel skeleton-stack"><el-skeleton :rows="8" animated/></div>
 <template v-else>
  <section class="metric-grid" aria-label="招聘关键指标"><article v-for="metric in metrics" :key="metric.label" :class="`tone-${metric.tone}`"><span>{{metric.label}}</span><strong>{{metric.value}}</strong><small>{{metric.note}}</small></article></section>
  <div class="dashboard-columns">
   <section class="surface-panel module-section"><div class="section-title-row"><div><span class="section-kicker">快捷入口</span><h2>招聘功能</h2><p>按照日常招聘流程进入对应工作模块</p></div><small>更新于 {{timeLabel()}}</small></div><div class="module-grid"><button v-for="item in modules" :key="item.route" type="button" class="module-card" @click="open(item.route)"><span class="module-icon" :class="`tone-${item.tone}`"><el-icon><component :is="item.icon"/></el-icon></span><span class="module-copy"><strong>{{item.title}}</strong><small>{{item.description}}</small><em>{{item.meta}}</em></span><el-icon class="module-arrow"><Right/></el-icon></button></div></section>
   <aside class="surface-panel attention-section"><div class="section-title-row"><div><span class="section-kicker">今日关注</span><h2>待处理事项</h2></div></div><div v-if="attention.length" class="attention-list"><button v-for="(item,index) in attention" :key="item" type="button" @click="open(index===0?'/boss-accounts':index===1?'/auto-replies':'/candidates')"><span><el-icon><Warning/></el-icon></span><strong>{{item}}</strong><el-icon><Right/></el-icon></button></div><div v-else class="all-clear"><span><el-icon><UserFilled/></el-icon></span><strong>当前没有紧急事项</strong><p>招聘流程和设备状态均无明显异常。</p></div>
    <div class="workflow"><h3>推荐工作顺序</h3><ol><li><span>1</span><div><strong>确认职位</strong><small>检查在招职位和账号绑定</small></div></li><li><span>2</span><div><strong>处理候选人</strong><small>完成筛选与人工复核</small></div></li><li><span>3</span><div><strong>检查自动跟进</strong><small>关注暂停账号和发送结果</small></div></li></ol></div>
   </aside>
  </div>
 </template>
</div></template>

<style scoped>
.dashboard-page{padding-top:32px}.dashboard-hero{display:flex;align-items:flex-end;justify-content:space-between;gap:24px;margin-bottom:24px;padding:8px 4px}.eyebrow,.section-kicker{color:var(--brand-700);font-size:12px;font-weight:800;letter-spacing:.08em}.dashboard-hero h1{margin:8px 0 7px;font-size:clamp(28px,3vw,40px);letter-spacing:-.035em}.dashboard-hero p{margin:0;color:var(--text-secondary);line-height:1.6}.metric-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:20px}.metric-grid article{position:relative;overflow:hidden;padding:20px 22px;border:1px solid var(--border);border-radius:16px;background:#fff;box-shadow:var(--shadow-sm)}.metric-grid article::after{position:absolute;inset:0 0 auto;height:3px;background:currentColor;content:'';opacity:.75}.metric-grid span,.metric-grid small{display:block;color:var(--text-secondary)}.metric-grid span{font-size:13px;font-weight:650}.metric-grid strong{display:block;margin:10px 0 5px;font-size:30px;line-height:1;font-variant-numeric:tabular-nums}.metric-grid small{font-size:12px}.dashboard-columns{display:grid;grid-template-columns:minmax(0,1.7fr) minmax(300px,.8fr);gap:20px}.module-section,.attention-section{overflow:hidden}.section-title-row small{color:var(--text-secondary)}.section-title-row h2{margin-top:5px}.module-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;padding:18px}.module-card{display:grid;grid-template-columns:48px 1fr auto;align-items:center;gap:14px;min-height:116px;padding:17px;border:1px solid var(--border);border-radius:13px;background:#fff;color:var(--text);text-align:left;cursor:pointer;transition:transform .18s ease,border-color .18s ease,box-shadow .18s ease}.module-card:hover{transform:translateY(-2px);border-color:#a9c9c4;box-shadow:var(--shadow-md)}.module-icon{display:grid;width:48px;height:48px;place-items:center;border-radius:13px;font-size:22px}.module-copy{display:grid;gap:5px}.module-copy strong{font-size:15px}.module-copy small{color:var(--text-secondary);line-height:1.45}.module-copy em{color:var(--brand-700);font-size:12px;font-style:normal;font-weight:700}.module-arrow{color:#98a2b3}.tone-blue{color:#175cd3}.module-icon.tone-blue{background:#eff8ff}.tone-violet{color:#6938ef}.module-icon.tone-violet{background:#f4f3ff}.tone-teal{color:#087f5b}.module-icon.tone-teal{background:#ecfdf3}.tone-orange{color:#b54708}.module-icon.tone-orange{background:#fff6ed}.tone-slate{color:#344054}.module-icon.tone-slate{background:#f2f4f7}.attention-list{display:grid;padding:16px}.attention-list button{display:grid;grid-template-columns:36px 1fr auto;align-items:center;gap:10px;padding:13px 4px;border:0;border-bottom:1px solid var(--border);background:transparent;color:var(--text);text-align:left;cursor:pointer}.attention-list button>span{display:grid;width:34px;height:34px;place-items:center;border-radius:9px;background:#fff4ed;color:#c4320a}.attention-list strong{font-size:13px;line-height:1.45}.all-clear{padding:28px 20px;text-align:center}.all-clear>span{display:grid;width:52px;height:52px;margin:auto;place-items:center;border-radius:15px;background:#ecfdf3;color:var(--success);font-size:23px}.all-clear strong{display:block;margin-top:12px}.all-clear p{margin:7px 0;color:var(--text-secondary);font-size:12px}.workflow{margin:0 18px 18px;padding:18px;border-radius:13px;background:var(--surface-soft)}.workflow h3{margin:0 0 15px;font-size:14px}.workflow ol{display:grid;gap:14px;margin:0;padding:0;list-style:none}.workflow li{display:flex;gap:11px}.workflow li>span{display:grid;width:24px;height:24px;flex:0 0 auto;place-items:center;border-radius:50%;background:var(--brand-900);color:#fff;font-size:11px;font-weight:800}.workflow strong,.workflow small{display:block}.workflow strong{font-size:13px}.workflow small{margin-top:3px;color:var(--text-secondary);font-size:11px}
@media(max-width:1100px){.metric-grid{grid-template-columns:repeat(2,1fr)}.dashboard-columns{grid-template-columns:1fr}.module-grid{grid-template-columns:repeat(2,1fr)}}@media(max-width:650px){.dashboard-hero{align-items:flex-start}.dashboard-hero .el-button{width:auto}.metric-grid,.module-grid{grid-template-columns:1fr}.metric-grid{gap:10px}.module-grid{padding:12px}.module-card{min-height:104px}.section-title-row>small{display:none}}
</style>
