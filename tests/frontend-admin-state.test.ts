// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DashboardView from '../frontend/src/views/DashboardView.vue';
import ClientDetailView from '../frontend/src/views/ClientDetailView.vue';
import ClientFormView from '../frontend/src/views/ClientFormView.vue';
import TokenModal from '../frontend/src/components/TokenModal.vue';
import ClientListView from '../frontend/src/views/ClientListView.vue';

const mocks = vi.hoisted(() => ({
  dashboard:vi.fn(), client:vi.fn(), logs:vi.fn(), config:vi.fn(), action:vi.fn(), rotate:vi.fn(), remove:vi.fn(),
  records:vi.fn(), update:vi.fn(), create:vi.fn(), clients:vi.fn(), routerPush:vi.fn(), routeQuery:{} as Record<string,string>,
}));

vi.mock('../frontend/src/services/api', () => ({ adminApi:mocks }));
vi.mock('vue-router', () => ({ useRouter:()=>({push:mocks.routerPush}), useRoute:()=>({query:mocks.routeQuery}) }));

const client = {
  id:'client-id',displayName:'Home',slug:'home-1',enabled:false,zoneId:'a'.repeat(32),zoneName:'example.com',recordId:'b'.repeat(32),
  recordName:'home.example.com',recordType:'A' as const,recordPending:false,tokenCreatedAt:'2026-01-01T00:00:00.000Z',tokenConfigured:true as const,
  currentDnsIp:'1.1.1.1',lastIp:'1.1.1.1',lastSourceIp:'8.8.8.8',lastStatus:'unchanged',lastUpdatedAt:'2026-01-01T00:00:00.000Z',createdAt:'2026-01-01T00:00:00.000Z',updatedAt:'2026-01-01T00:00:00.000Z',
};
const config = {ddnsOrigin:'https://ddns.example.com',dnsZoneId:'a'.repeat(32),dnsZoneName:'example.com',unifiCompatibilityEnabled:false};
const global = {stubs:{RouterLink:{template:'<a><slot /></a>'},TokenModal:true}};

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(mocks.routeQuery)) delete mocks.routeQuery[key];
  mocks.client.mockResolvedValue(client); mocks.logs.mockResolvedValue([]); mocks.config.mockResolvedValue(config); mocks.records.mockResolvedValue([]);
  mocks.clients.mockResolvedValue([client]);
  mocks.routerPush.mockResolvedValue(undefined); mocks.update.mockResolvedValue(client);
});
afterEach(() => vi.restoreAllMocks());

describe('admin UI runtime states', () => {
  it('shows a dashboard API error instead of silently rendering zeroes', async () => {
    mocks.dashboard.mockRejectedValue(new Error('Dashboard unavailable'));
    const wrapper = mount(DashboardView, {global});
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('Dashboard unavailable');
    expect(wrapper.findAll('.stat-value')).toHaveLength(0);
  });

  it('gates every UniFi action on runtime config', async () => {
    const detail = mount(ClientDetailView, {props:{id:'client-id'},global});
    await flushPromises();
    expect(detail.text()).not.toContain('複製 UniFi');
    const hidden = mount(TokenModal, {props:{token:'test-token',slug:'home-1',ddnsOrigin:'https://ddns.example.com',unifiCompatibilityEnabled:false}});
    expect(hidden.text()).not.toContain('複製 UniFi');
    const enabled = mount(TokenModal, {props:{token:'test-token',slug:'home-1',ddnsOrigin:'https://ddns.example.com',unifiCompatibilityEnabled:true}});
    expect(enabled.text()).toContain('複製 UniFi');
  });

  it('shows mutation loading and success states', async () => {
    let finish:(value:typeof client)=>void = () => undefined;
    mocks.action.mockReturnValue(new Promise<typeof client>((resolve)=>{finish=resolve;}));
    const wrapper = mount(ClientDetailView, {props:{id:'client-id'},global});
    await flushPromises();
    await wrapper.get('.page-header button').trigger('click');
    expect(wrapper.text()).toContain('處理中…');
    finish({...client,enabled:true});
    await flushPromises();
    expect(wrapper.get('[role="status"]').text()).toContain('Client 已啟用');
  });

  it('propagates update success to the detail route', async () => {
    const wrapper = mount(ClientFormView, {props:{id:'client-id'},global});
    await flushPromises();
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(mocks.update).toHaveBeenCalled();
    expect(mocks.routerPush).toHaveBeenCalledWith({path:'/clients/client-id',query:{success:'updated'}});
  });

  it('shows delete success on the client list landing page', async () => {
    mocks.routeQuery.success = 'deleted';
    const pinia = createPinia();
    setActivePinia(pinia);
    const wrapper = mount(ClientListView, {global:{...global,plugins:[pinia]}});
    await flushPromises();
    expect(wrapper.get('[role="status"]').text()).toBe('Client 已刪除');
  });
});
