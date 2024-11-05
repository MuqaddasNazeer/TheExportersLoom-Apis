import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { randomInt } from 'crypto';
import { DataSource, MoreThan, Repository } from 'typeorm';
import { UserAuthentication } from '../auth/entities/auth.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { EmailVerificationToken } from './entities/email-verification.entity';
import { ResetToken } from './entities/reset-token.entity';
import { UserProfile } from './entities/user-profile.entity';
import { User } from './entities/user.entity';
import { MailService } from './services/mail.service';
import { UpdateUserDto } from './dto/update-users.dto';




@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,

    @InjectRepository(UserProfile)
    private readonly userProfileRepository: Repository<UserProfile>,

    @InjectRepository(UserAuthentication)
    private readonly userAuthRepository: Repository<UserAuthentication>,

    @InjectRepository(ResetToken)
    private resetTokenRepo: Repository<ResetToken>,
    @InjectRepository(EmailVerificationToken)
    private emailVerificationTokenRepo: Repository<EmailVerificationToken>,

    private jwtService: JwtService,
    private dataSource: DataSource,
    private readonly mailService: MailService,
  ) {}

  async create(createUserDto: CreateUserDto): Promise<any> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
  
    try {
      // Check if the user already exists by email
      const existingUser = await this.findUserByEmail(createUserDto.email);
      if (existingUser) {
        throw new Error('User with this email already exists');
      }
  
      // Create User instance
      const newUser = this.userRepository.create({
        username: createUserDto.username,
        email: createUserDto.email,
        userType: createUserDto.userType,
      });
  
      // Save User to get the user_id
      const savedUser = await queryRunner.manager.save(newUser);
  
      // Create and save UserProfile, linking it to the saved User
      const userProfile = this.userProfileRepository.create({
        user: savedUser, // Link the profile to the saved user
        name: createUserDto.name,
        company_name: createUserDto.companyName,
        phone_number: createUserDto.phone,
        cnic: createUserDto.cnic,
        address: createUserDto.address,
      });
      const savedProfile = await queryRunner.manager.save(userProfile);
  
      // Update User to reference the saved UserProfile
      savedUser.profile = savedProfile;
      await queryRunner.manager.save(savedUser);
  
      // Hash Password and create UserAuthentication entry
      const salt = await bcrypt.genSalt();
      const hashedPassword = await bcrypt.hash(createUserDto.password, salt);
  
      const userAuth = this.userAuthRepository.create({
        user: savedUser,
        passwordHash: hashedPassword,
        TwoFactorEnabled: false,
        isEmailVerified: false,
        isPhoneVerified: false,
      });
      await queryRunner.manager.save(userAuth);
  
      // Generate JWT Tokens
      const payload = { username: savedUser.username, sub: savedUser.user_id };
      const accessToken = this.jwtService.sign(payload);
      const refreshToken = this.jwtService.sign(payload, { expiresIn: '7d' });
  
      await queryRunner.commitTransaction();
  
      return {
        message: 'User created successfully',
        accessToken,
        refreshToken,
      };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw new Error('Transaction failed: ' + error.message);
    } finally {
      await queryRunner.release();
    }
  }
  findOne(id: number) {
    if (!id) return null;
    return this.userRepository.findOneBy({ user_id: id });
  }



  // Method to handle forgot password and generate a reset token

  async forgotPassword(email: string) {
    const existingUser = await this.findUserByEmail(email);
    if (existingUser) {
      // Generate a 6-digit reset code
      const resetCode = randomInt(100000, 999999).toString();
      const expiryDate = new Date();
      expiryDate.setHours(expiryDate.getHours() + 1); // Expires in 1 hour

      // Check if there's an existing reset code entry for the user
      let resetTokenObj = await this.resetTokenRepo.findOne({
        where: { userId: existingUser.user_id },
      });

      if (resetTokenObj) {
        resetTokenObj.token = resetCode;
        resetTokenObj.expiryDate = expiryDate;
      } else {
        resetTokenObj = this.resetTokenRepo.create({
          token: resetCode,
          userId: existingUser.user_id,
          expiryDate,
        });
      }

      await this.resetTokenRepo.save(resetTokenObj);

      // Send the email with the reset code
      this.mailService.sendMail(
        existingUser.email,
        'Password Reset Code',
        `Your password reset code is: ${resetCode} \n\nThis code will expire in 1 hour`,
      );

      return {
        message: 'Reset password code sent to the specified email',
        resetCode,
      };
    } else {
      throw new Error('User with this email does not exist');
    }
  }
  
  async resetPassword(email: string, resetToken: string, newPassword: string) {
    const token = await this.resetTokenRepo.findOne({
      where: { token: resetToken, expiryDate: MoreThan(new Date()) },
    });

    if (!token) {
      throw new UnauthorizedException('Invalid Code or Code Expired!!');
    }
    this.resetTokenRepo.remove(token);

    const existingUser = await this.findOne(token.userId);
    if (!existingUser) {
      throw new NotFoundException('User not found');
    }
    if (existingUser.email !== email) {
      throw new UnauthorizedException('Invalid Email');
    }
    const authUser = await this.userAuthRepository.findOne({
      where: { user: { user_id: existingUser.user_id } },
    });
    authUser.passwordHash = await this.encrypt(newPassword);
    await this.userAuthRepository.save(authUser);
    return { message: 'Password has been changed!!' };
  }
  async encrypt(password: string): Promise<string> {
    const salt = await bcrypt.genSalt();
    const hashedPassword = await bcrypt.hash(password, salt);
    return hashedPassword;
  }
  async requestEmailVerification(email: string) {
    const existingUser = await this.findUserByEmail(email);
    if (!existingUser) {
      throw new UnauthorizedException('Invalid Email');
    }

    // Generate a 6-digit random number for verification
    const verificationCode = Math.floor(
      100000 + Math.random() * 900000,
    ).toString();
    const expiryDate = new Date();
    expiryDate.setMinutes(expiryDate.getMinutes() + 10);

    // Save or update the verification code with expiry in the database
    const existingToken = await this.emailVerificationTokenRepo.findOne({
      where: { userId: existingUser.user_id },
    });

    if (existingToken) {
      // Update existing token
      existingToken.token = verificationCode;
      existingToken.expiryDate = expiryDate;
      await this.emailVerificationTokenRepo.save(existingToken);
    } else {
      // Create a new token entry
      await this.emailVerificationTokenRepo.save({
        token: verificationCode,
        userId: existingUser.user_id,
        expiryDate,
      });
    }

    // Send the verification code via email
    this.mailService.sendMail(
      existingUser.email,
      'Email Verification',
      `Your verification code is: ${verificationCode}\n\nThis code will expire in 10 minutes.`,
    );

    return {
      message: 'Verification code sent to the specified email',
      verificationCode,
    };
  }
  async verifyEmail(email: string, verificationCode: string) {
    // Find the user by email
    const user = await this.findUserByEmail(email);
    if (!user) {
      throw new BadRequestException('Invalid email address');
    }

    // Retrieve the verification code entry for the user
    const verificationEntry = await this.emailVerificationTokenRepo.findOne({
      where: { userId: user.user_id },
    });

    if (!verificationEntry) {
      throw new UnauthorizedException('Verification code not found');
    }

    // Check if the code matches and is still valid
    if (verificationEntry.token !== verificationCode) {
      throw new UnauthorizedException('Invalid verification code');
    }

    if (verificationEntry.expiryDate < new Date()) {
      throw new UnauthorizedException('Verification code has expired');
    }

    const authUser = await this.userAuthRepository.findOne({
      where: { user: { user_id: user.user_id } },
    });
    if (!authUser) {
      throw new UnauthorizedException('User not found');
    }
    authUser.isEmailVerified = true;
    await this.userAuthRepository.save(authUser);

    // Delete the verification entry from the database
    await this.emailVerificationTokenRepo.delete({ userId: user.user_id });

    return { message: 'Email verified successfully' };
  }

  // Find user by email
  async findUserByEmail(email: string): Promise<User | undefined> {
    return await this.userRepository.findOne({ where: { email } });
  }

  // Validate user credentials for regular login
  async validateUser(email: string, password: string): Promise<any> {
    const user = await this.findByEmailWithAuth(email);
    if (!user || !user.userAuth || user.userAuth.length === 0) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const userAuth = user.userAuth[0];
    const isPasswordValid = await bcrypt.compare(
      password,
      userAuth.passwordHash,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }
    return user;
  }

  // Generate JWT token after successful login
  async login(user: any) {
    const payload = {
      username: user.username,
      sub: user.user_id,
      userType: user.userType,
    };
    return {
      access_token: this.jwtService.sign(payload),
    };
  }

  //get all users
  async findAll(): Promise<User[]> {
    return this.userRepository.find({
      relations: ['profile'], 
    });
  }

//get user by id
async findOneById(id: number): Promise<User | undefined> {
  return await this.userRepository.findOne({
    where: { user_id: id },
    relations: ['profile'],
  });
}

// find user by email in UserRepository with UserAuthentication relation
async findByEmailWithAuth(email: string): Promise<User> {
  return await this.userRepository.findOne({
    where: { email },
    relations: ['userAuth'], 
  });
}

async deleteUserById(id: number): Promise<{ message: string }> {
  const user = await this.userRepository.findOne({ where: { user_id: id } });
  if (!user) {
    throw new NotFoundException(`User with ID ${id} not found`);
  }
  user.isActive = false;
  await this.userRepository.save(user);
  return { message: 'User status set to inactive successfully' };
}

async updateUser(userId: number, updateUserDto: UpdateUserDto): Promise<User> {
  const queryRunner = this.dataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    // Find the existing user
    const user = await this.userRepository.findOne({
      where: { user_id: userId },
      relations: ['profile'],
    });

    if (!user) {
      throw new Error(`User with ID ${userId} not found`);
    }

    // Update User fields
    if (updateUserDto.username) user.username = updateUserDto.username;
    if (updateUserDto.email) user.email = updateUserDto.email;

    // Update UserProfile fields
    if (user.profile) {
      if (updateUserDto.name) user.profile.name = updateUserDto.name;
      if (updateUserDto.company_name) user.profile.company_name = updateUserDto.company_name;
      if (updateUserDto.phone_number) user.profile.phone_number = updateUserDto.phone_number;
      if (updateUserDto.cnic) user.profile.cnic = updateUserDto.cnic;
      if (updateUserDto.address) user.profile.address = updateUserDto.address;

      // Save updated profile
      await queryRunner.manager.save(user.profile);
    }

    // Save the updated User entity
    const updatedUser = await queryRunner.manager.save(user);

    await queryRunner.commitTransaction();
    return updatedUser;
  } catch (error) {
    await queryRunner.rollbackTransaction();
    throw new Error('Transaction failed: ' + error.message);
  } finally {
    await queryRunner.release();
  }
}
}


