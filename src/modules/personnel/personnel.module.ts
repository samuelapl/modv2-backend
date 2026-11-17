import { Module } from '@nestjs/common';
import { PersonnelController } from './personnel.controller';
import { PersonnelService } from './personnel.service';
import { UnitsController } from './controllers/units.controller';
import { DriversController } from './controllers/drivers.controller';
import { UnitsService } from './services/units.service';
import { DriversService } from './services/drivers.service';

@Module({
  controllers: [PersonnelController, UnitsController, DriversController],
  providers: [PersonnelService, UnitsService, DriversService],
  exports: [PersonnelService, UnitsService, DriversService],
})
export class PersonnelModule {}
