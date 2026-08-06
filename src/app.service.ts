import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHealth() {
    return {
      status: 'ok',
      service: 'AI Fashion Try-On API',
      version: '2.0.0',
      timestamp: new Date().toISOString(),
      endpoints: {
        tryOn: '/api/try-on',
        stylist: '/api/stylist/analyze',
        docs: '/api/docs',
      },
    };
  }
}
