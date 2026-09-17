import { describe, it, expect, vi } from 'vitest';
import { onlineStorePublication, publishOnlineStore } from './shopify-publication';
describe('Shopify 온라인 스토어 게시', () => {
  it('권한이 없으면 상품 생성 전에 중단할 사유를 반환한다', async () => {
    await expect(onlineStorePublication(vi.fn().mockResolvedValue({ errors: [{ message: 'Access denied' }] }))).rejects.toThrow('read_publications·write_publications');
  });
  it('온라인 스토어만 선택한다', async () => {
    const request = vi.fn().mockResolvedValue({ data: { currentAppInstallation: { accessScopes: [{ handle: 'write_publications' }] }, publications: { nodes: [{ id: 'pos', name: 'Point of Sale' }, { id: 'web', name: 'Online Store' }] } } });
    expect(await onlineStorePublication(request)).toBe('web');
  });
  it('게시 후 실제 공개 상태를 확인한다', async () => {
    const request = vi.fn().mockResolvedValueOnce({ data: { publishablePublish: { userErrors: [] } } }).mockResolvedValueOnce({ data: { product: { status: 'ACTIVE', publishedOnPublication: true } } });
    await publishOnlineStore(request, '123', 'web');
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0][0].body.variables).toEqual({ id: 'gid://shopify/Product/123', input: [{ publicationId: 'web' }] });
  });
  it('ACTIVE만으로 게시 성공 처리하지 않는다', async () => {
    const request = vi.fn().mockResolvedValueOnce({ data: { publishablePublish: { userErrors: [] } } }).mockResolvedValueOnce({ data: { product: { status: 'ACTIVE', publishedOnPublication: false } } });
    await expect(publishOnlineStore(request, '123', 'web')).rejects.toThrow('게시 결과');
  });
});
