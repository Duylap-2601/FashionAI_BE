import { Module } from '@nestjs/common';
import { ShippingModule } from '../shipping/shipping.module';
import { UserAddressesController } from './user-addresses.controller';
import { UserAddressesService } from './user-addresses.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [ShippingModule],
  controllers: [UsersController, UserAddressesController],
  providers: [UsersService, UserAddressesService],
  exports: [UsersService, UserAddressesService],
})
export class UsersModule {}
