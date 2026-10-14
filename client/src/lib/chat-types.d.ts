import type {
  ChatUserDto,
  ConversationDetailDto,
  ConversationDto,
} from '../lib/types';

declare module '../lib/types' {
  export interface ConversationMemberDto {
    user: ChatUserDto;
  }
}
