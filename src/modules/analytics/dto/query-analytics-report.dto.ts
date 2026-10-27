import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional } from 'class-validator';
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

  @ApiProperty({
    description: 'Bỏ qua cache 15 phút để lấy số liệu mới từ GA4 (nút làm mới của admin).',
    required: false,
    type: Boolean,
  })
  @IsBoolean()
  @IsOptional()
  refresh?: boolean;
}
