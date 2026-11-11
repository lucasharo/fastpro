import { Module } from '@nestjs/common';
import { SpikeController } from './spike.controller';

@Module({ controllers: [SpikeController] })
export class AppModule {}
