import { ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { JwtAuthGuard } from '../../src/modules/auth/guards/jwt-auth.guard';
import { LiveTryOnController } from '../../src/modules/try-on/live-try-on.controller';
import { LiveTryOnService } from '../../src/modules/try-on/live-try-on.service';

describe('Live resume product selection (HTTP)', () => {
  let app: INestApplication;
  const user = { id: 'user-1' };
  const resumeSession = jest.fn().mockResolvedValue({ sessionId: 'session-1', remainingSeconds: 40 });

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [LiveTryOnController],
      providers: [{ provide: LiveTryOnService, useValue: { resumeSession } }],
    }).overrideGuard(JwtAuthGuard).useValue({
      canActivate(context: ExecutionContext) {
        context.switchToHttp().getRequest().user = user;
        return true;
      },
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => { await app.close(); });
  beforeEach(() => { resumeSession.mockClear(); });

  it('accepts a new product when resuming the same session', async () => {
    const productId = '44444444-4444-4444-8444-444444444444';
    await request(app.getHttpServer()).post('/try-on/live/sessions/session-1/resume').send({ productId }).expect(200);
    expect(resumeSession).toHaveBeenCalledWith(user, 'session-1', undefined, productId);
  });

  it('keeps empty-body resume backward compatible', async () => {
    await request(app.getHttpServer()).post('/try-on/live/sessions/session-1/resume').send({}).expect(200);
    expect(resumeSession).toHaveBeenCalledWith(user, 'session-1', undefined, undefined);
  });

  it('rejects an invalid product ID before calling the service', async () => {
    await request(app.getHttpServer()).post('/try-on/live/sessions/session-1/resume').send({ productId: 'invalid' }).expect(400);
    expect(resumeSession).not.toHaveBeenCalled();
  });
});
