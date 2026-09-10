import { Injectable } from '@nestjs/common';
import { ShippingProviderType } from './constants/shipping-provider.enum';
import { IShippingProvider } from './interfaces/shipping-provider.interface';
import { GhnShippingProvider } from './providers/ghn/ghn.provider';

@Injectable()
export class ShippingProviderFactory {
  constructor(private readonly ghnProvider: GhnShippingProvider) {}

  get(provider: ShippingProviderType): IShippingProvider {
    switch (provider) {
      case ShippingProviderType.GHN:
        return this.ghnProvider;
      default:
        throw new Error(`Unsupported shipping provider: ${provider}`);
    }
  }
}
