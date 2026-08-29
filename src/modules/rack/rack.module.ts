import { Module } from '@nestjs/common';
import { RackController } from './rack.controller';
import { RackService } from './rack.service';

@Module({
  controllers: [RackController],
  providers: [RackService],
  exports: [RackService],
})
export class RackModule {}
