import { BadRequestException } from '@nestjs/common';
import { StylistController } from '../../src/modules/stylist/stylist.controller';
import { StylistService } from '../../src/modules/stylist/stylist.service';
import { StylistRequestDto } from '../../src/modules/stylist/dto/stylist-request.dto';

describe('StylistController', () => {
  let controller: StylistController;
  let service: any;

  beforeEach(() => {
    service = {
      analyzeAndAdvise: jest.fn(),
      getUserHistory: jest.fn(),
      getHistoryItem: jest.fn(),
      deleteHistoryItem: jest.fn(),
    };
    controller = new StylistController(service as StylistService);
  });

  const buildRequest = (url = '/api/stylist/analyze') =>
    ({ originalUrl: url, url }) as any;
  const user = { id: 'user-1', email: 'a@b.c' } as any;

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should reject analyze when humanImage is missing', async () => {
    const dto = new StylistRequestDto();
    dto.garmentDescription = 'Vest navy';

    await expect(
      controller.analyze(buildRequest(), user, undefined as any, dto),
    ).rejects.toThrow(BadRequestException);
  });

  it('should reject analyze when the uploaded file is not an image', async () => {
    const dto = new StylistRequestDto();
    dto.garmentDescription = 'Vest navy';
    const file = { buffer: Buffer.from('x'), mimetype: 'text/plain', size: 10 } as any;

    await expect(controller.analyze(buildRequest(), user, file, dto)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('should return success payload with analysis data', async () => {
    const dto = new StylistRequestDto();
    dto.garmentDescription = 'Vest navy';
    dto.occasion = 'Công sở';
    const file = {
      buffer: Buffer.from('fake-image'),
      mimetype: 'image/png',
      size: 100,
    } as any;

    const serviceResult = {
      id: 'result-1',
      humanImageUrl: 'https://cdn/x.png',
      analysisResult: { verdict: 'Phù hợp' },
      createdAt: new Date(),
    };
    service.analyzeAndAdvise.mockResolvedValue(serviceResult);

    const result = await controller.analyze(buildRequest(), user, file, dto);

    expect(service.analyzeAndAdvise).toHaveBeenCalledWith(
      'user-1',
      file,
      expect.objectContaining({ garmentDescription: 'Vest navy' }),
    );
    expect(result).toMatchObject({
      success: true,
      code: 'STYLIST_ANALYZE_SUCCESS',
      data: serviceResult,
    });
  });

  it('getHistory should return items with meta', async () => {
    service.getUserHistory.mockResolvedValue({
      items: [{ id: 'r1' }],
      meta: { total: 1, page: 1, limit: 20, totalPages: 1 },
    });

    const result = await controller.getHistory(buildRequest('/api/stylist/history'), user);

    expect(result).toMatchObject({ success: true, data: [{ id: 'r1' }] });
    expect(result.meta.totalPages).toBe(1);
  });

  it('deleteHistoryItem should return success with null data', async () => {
    service.deleteHistoryItem.mockResolvedValue({ id: 'r1' });

    const result = await controller.deleteHistoryItem(
      buildRequest('/api/stylist/history/r1'),
      user,
      'r1',
    );

    expect(service.deleteHistoryItem).toHaveBeenCalledWith('user-1', 'r1');
    expect(result).toMatchObject({ success: true, code: 'STYLIST_DELETE_SUCCESS', data: null });
  });
});
