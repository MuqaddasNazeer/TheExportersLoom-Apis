import { Entity, PrimaryGeneratedColumn, Column, OneToMany, ManyToOne } from 'typeorm';
import { FabricPricingModule } from '../../modules/fabric-price module/entities/fabric-pricing-module.entity';
import { FabricQuantity } from '../../modules/fabric-quantity-module/entities/fabric-quantity.entity';
import { Cutting } from '../../modules/cutting module/entities/cutting.entity';
import { LogoPrinting } from '../../modules/logo-printing module/entities/logo-printing.entity';
import { Stitching } from '../../modules/stitching module/entities/stitching.entity';
import { Packaging } from '../../modules/packaging module/entities/packaging.entity';
import {Module} from './module.entity';
import { User } from 'users/entities/user.entity';

@Entity('project')
export class Project {
  @PrimaryGeneratedColumn()
  id: number;

  // @Column()
  // userId: number;
  @ManyToOne(() => User, (user) => user.projects, { nullable: true })
  user: User;

  @Column({ nullable: true })
  responseId: number;

  // @Column()
  // status: string;

  @Column({ type: 'varchar', length: 50, default: 'pending' })
  status: string; 
  
  @Column()
  shirtType: string;

  @Column()
  fabricCategory: string;

  @Column({ nullable: true })
  fabricSubCategory: string;

  @Column()
  fabricSize: string;

  @Column()
  logoPosition: string;

  @Column()
  printingStyle: string;

  @Column()
  logoSize: string;

  @Column()
  cuttingStyle: string;

  @Column()
  quantity: number;

  @OneToMany(() => Module, (module) => module.project)
modules: Module[];


  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  totalEstimatedCost: number;

  @OneToMany(() => FabricPricingModule, (module) => module.project)
  fabricPriceModules: FabricPricingModule[];

  @OneToMany(() => FabricQuantity, (module) => module.project)
  fabricQuantities: FabricQuantity[];

  @OneToMany(() => Cutting, (module) => module.project)
  cuttings: Cutting[];

  @OneToMany(() => LogoPrinting, (module) => module.project)
  logoPrintingModules: LogoPrinting[];

  @OneToMany(() => Stitching, (module) => module.project)
  stitchingModules: Stitching[];

  @OneToMany(() => Packaging, (module) => module.project)
  packagingModules: Packaging[];
}
