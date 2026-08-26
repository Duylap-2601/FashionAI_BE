import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class StylistResponseDto {
  @ApiProperty({ example: 'Dáng người chữ V cân đối' })
  bodyType!: string;

  @ApiProperty({ example: 'Da sáng, tông lạnh (Cool Winter)' })
  skinTone!: string;

  @ApiProperty({ example: 'Winter - Hợp với màu lạnh: Navy, Charcoal, Trắng' })
  personalColor!: string;

  @ApiProperty({ example: 'Slim-fit sẽ tôn dáng người chữ V của bạn' })
  fitRecommendation!: string;

  @ApiPropertyOptional({
    example: 'Nên may ôm nhẹ ở eo, chừa rộng phần vai để thoải mái',
    description:
      'Gợi ý phom/độ ôm khi đặt may theo số đo cơ thể (không dùng size chữ S/M/L)',
  })
  fitAdvice?: string;

  @ApiPropertyOptional({
    example: 85,
    description: 'Điểm tương thích sản phẩm (0-100) khi có productId, ngược lại null',
  })
  productCompatibilityScore?: number | null;

  @ApiProperty({
    type: [String],
    example: ['Navy Blue', 'Charcoal Gray', 'Midnight Black'],
  })
  colorSuggestions!: string[];

  @ApiProperty({
    type: [String],
    example: [
      'Vest Navy + quần Kaki sáng + Oxford trắng + giày Oxford đen',
      'Vest + quần jeans đen slim-fit + áo polo trắng (smart casual)',
      'Full suit Navy + cà vạt bạc + giày da đen (formal)',
    ],
  })
  outfitCombinations!: string[];

  @ApiProperty({ example: 'Cài nút áo vest khi đứng, mở khi ngồi để tránh nhăn vải' })
  stylingTips!: string;

  @ApiProperty({ example: 'Rất phù hợp! Chiếc vest này sẽ làm bạn tự tin và chuyên nghiệp.' })
  verdict!: string;
}
