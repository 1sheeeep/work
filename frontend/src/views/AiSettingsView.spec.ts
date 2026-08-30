import { flushPromises, mount } from '@vue/test-utils'
import { api } from '../services/api'
import AiSettingsView from './AiSettingsView.vue'

const push = vi.fn()
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }))
vi.mock('../services/api', () => ({
  api: { get: vi.fn(), post: vi.fn() },
  ensureCsrf: vi.fn(),
  apiErrorMessage: (_error: unknown, fallback: string) => fallback,
}))

describe('AiSettingsView', () => {
  it('shows safe server-side configuration state and runs a data-free test', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ data: {
      enabled: true, apiKeyConfigured: true, modelConfigured: true, officialEndpoint: true,
      ready: true, model: 'configured-model', endpointHost: 'api.openai.com', timeoutSeconds: 60,
      resultRetentionDays: 90, requestStorageDisabled: true, status: 'READY_FOR_TEST', missingConfiguration: [],
    } })
    vi.mocked(api.post).mockResolvedValueOnce({ data: {
      success: true, model: 'configured-model', requestId: 'req-safe-id', elapsedMilliseconds: 250,
      checkedAt: '2026-08-30T08:00:00Z', message: 'OpenAI 已连接，Structured Outputs 测试通过',
    } })

    const wrapper = mount(AiSettingsView)
    await flushPromises()

    expect(wrapper.text()).toContain('服务端 API Key')
    expect(wrapper.text()).toContain('永不显示密钥内容')
    expect(wrapper.text()).toContain('store=false')
    await wrapper.findAll('button').find(button => button.text().includes('测试 OpenAI 连接'))?.trigger('click')
    await flushPromises()

    expect(api.post).toHaveBeenCalledWith('/ai-configuration/test', {}, { timeout: 75_000 })
    expect(wrapper.text()).toContain('req-safe-id')
  })
})
