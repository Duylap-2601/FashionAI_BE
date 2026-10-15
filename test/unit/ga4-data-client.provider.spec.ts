import { createGa4DataClient } from '../../src/modules/analytics/ga4-data-client.provider';

const PEM_ESCAPED = '-----BEGIN PRIVATE KEY-----\\nTESTKEY\\n-----END PRIVATE KEY-----\\n';

describe('createGa4DataClient', () => {
  it('trả null khi thiếu email hoặc private key', () => {
    expect(createGa4DataClient(undefined, PEM_ESCAPED)).toBeNull();
    expect(createGa4DataClient('sa@test.iam.gserviceaccount.com', undefined)).toBeNull();
    expect(createGa4DataClient('  ', '  ')).toBeNull();
  });

  it('trả null khi private key không phải PEM', () => {
    expect(createGa4DataClient('sa@test.iam.gserviceaccount.com', 'your-private-key')).toBeNull();
  });

  it('tạo client và đổi "\\n" trong biến môi trường thành xuống dòng thật', async () => {
    const client = createGa4DataClient('sa@test.iam.gserviceaccount.com', PEM_ESCAPED) as unknown as {
      auth: { jsonContent?: { private_key?: string } };
      close: () => Promise<void>;
    };

    expect(client).not.toBeNull();
    expect(client.auth.jsonContent?.private_key).toBe(
      '-----BEGIN PRIVATE KEY-----\nTESTKEY\n-----END PRIVATE KEY-----',
    );
    await client.close();
  });
});
