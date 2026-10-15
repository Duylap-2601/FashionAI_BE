import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { ANALYTICS_RANGES, AnalyticsRange } from '../constants/analytics.constants';

export class QueryAnalyticsReportDto {
  @ApiProperty({
    description: 'Khoảng thời gian báo cáo, tính đến hôm nay. Mặc định 28 ngày.',
    enum: ANALYTICS_RANGES,
    example: '28d',
    required: false,
  })
  @IsIn(ANALYTICS_RANGES)
  @IsOptional()
  range?: AnalyticsRange;
}
