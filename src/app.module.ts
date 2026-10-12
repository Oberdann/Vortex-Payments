import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { ExceptionGlobalFilter } from './common/filters/exception-global-filter';
import { loggerConfig } from './config/pino-module-config';
import { MetricsModule } from './observability/metrics/metrics.module';
import { PaymentsModule } from './modules/payments/payments.module';

@Module({
  imports: [
    LoggerModule.forRoot(loggerConfig),
    MetricsModule,
    PaymentsModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: ExceptionGlobalFilter }],
})
export class AppModule {}
