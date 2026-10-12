import { Params } from 'nestjs-pino';

export const loggerConfig: Params = {
  pinoHttp: {
    level: 'info',
    base: { service: 'payments-service' },
    serializers: { res: (res) => ({ statusCode: res.statusCode }) },
    customLogLevel: (_request, response, error) => {
      if (response.statusCode >= 500 || error) return 'error';
      if (response.statusCode >= 400) return 'warn';
      return 'info';
    },
  },
};
