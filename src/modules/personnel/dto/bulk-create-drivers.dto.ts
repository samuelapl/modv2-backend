import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { CreateDriverDto } from './create-driver.dto';

export class BulkCreateDriversDto {
  @ApiProperty({ type: [CreateDriverDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => CreateDriverDto)
  drivers: CreateDriverDto[];
}
