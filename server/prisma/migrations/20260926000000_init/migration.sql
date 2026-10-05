-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "googleId" TEXT,
    "escrowWrappedMasterKey" TEXT,
    "escrowMasterKeyIv" TEXT,
    "escrowUpdatedAt" TIMESTAMP(3),
    "publicKey" TEXT NOT NULL,
    "wrappedPrivateKey" TEXT NOT NULL,
    "privateKeyIv" TEXT NOT NULL,
    "kdfSalt" TEXT NOT NULL,
    "kdfIterations" INTEGER NOT NULL DEFAULT 210000,
    "wrappedMasterKey" TEXT NOT NULL,
    "masterKeyIv" TEXT NOT NULL,
    "wrappedMasterKeyRecovery" TEXT,
    "masterKeyRecoveryIv" TEXT,
    "recoveryKdfSalt" TEXT,
    "recoveryKdfIterations" INTEGER,
    "recoveryKeyHash" TEXT,
    "recoveryKeyUsedAt" TIMESTAMP(3),
    "cipherId" TEXT NOT NULL,
    "username" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OtpToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT 'PASSWORD_RESET',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OtpToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Note" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "encryptionVersion" INTEGER NOT NULL DEFAULT 1,
    "algorithm" TEXT NOT NULL DEFAULT 'AES-GCM-256',
    "payloadBytes" INTEGER NOT NULL DEFAULT 0,
    "wrappedNoteKey" TEXT NOT NULL,
    "noteKeyIv" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecureFile" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "encryptedBytes" INTEGER NOT NULL,
    "plaintextBytes" INTEGER NOT NULL,
    "extension" TEXT,
    "wrappedFileKey" TEXT NOT NULL,
    "fileKeyIv" TEXT NOT NULL,
    "wrappedForNoteKey" TEXT NOT NULL,
    "noteKeyWrapIv" TEXT NOT NULL,
    "fileIv" TEXT NOT NULL,
    "encryptionVersion" INTEGER NOT NULL DEFAULT 1,
    "algorithm" TEXT NOT NULL DEFAULT 'AES-GCM-256',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "SecureFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NoteShare" (
    "id" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "sharedWithId" TEXT NOT NULL,
    "wrappedKey" TEXT NOT NULL,
    "keyAlgorithm" TEXT NOT NULL DEFAULT 'RSA-OAEP-2048-SHA256',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "NoteShare_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "contextNoteId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationMember" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "wrappedConversationKey" TEXT NOT NULL,
    "keyAlgorithm" TEXT NOT NULL DEFAULT 'RSA-OAEP-2048-SHA256',
    "hiddenAt" TIMESTAMP(3),
    "lastReadAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EncryptedMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "encryptionVersion" INTEGER NOT NULL DEFAULT 1,
    "algorithm" TEXT NOT NULL DEFAULT 'AES-GCM-256',
    "payloadBytes" INTEGER NOT NULL DEFAULT 0,
    "clientId" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EncryptedMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatBlock" (
    "id" TEXT NOT NULL,
    "blockerId" TEXT NOT NULL,
    "blockedId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "noteId" TEXT,
    "metadata" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_googleId_key" ON "User"("googleId");

-- CreateIndex
CREATE UNIQUE INDEX "User_cipherId_key" ON "User"("cipherId");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX "OtpToken_userId_purpose_idx" ON "OtpToken"("userId", "purpose");

-- CreateIndex
CREATE INDEX "Note_ownerId_idx" ON "Note"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "SecureFile_storageKey_key" ON "SecureFile"("storageKey");

-- CreateIndex
CREATE INDEX "SecureFile_noteId_deletedAt_idx" ON "SecureFile"("noteId", "deletedAt");

-- CreateIndex
CREATE INDEX "SecureFile_ownerId_createdAt_idx" ON "SecureFile"("ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "NoteShare_sharedWithId_idx" ON "NoteShare"("sharedWithId");

-- CreateIndex
CREATE INDEX "NoteShare_noteId_idx" ON "NoteShare"("noteId");

-- CreateIndex
CREATE UNIQUE INDEX "NoteShare_noteId_sharedWithId_key" ON "NoteShare"("noteId", "sharedWithId");

-- CreateIndex
CREATE INDEX "Conversation_updatedAt_idx" ON "Conversation"("updatedAt");

-- CreateIndex
CREATE INDEX "ConversationMember_userId_idx" ON "ConversationMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationMember_conversationId_userId_key" ON "ConversationMember"("conversationId", "userId");

-- CreateIndex
CREATE INDEX "EncryptedMessage_conversationId_createdAt_idx" ON "EncryptedMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "EncryptedMessage_senderId_createdAt_idx" ON "EncryptedMessage"("senderId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EncryptedMessage_conversationId_senderId_clientId_key" ON "EncryptedMessage"("conversationId", "senderId", "clientId");

-- CreateIndex
CREATE INDEX "ChatBlock_blockerId_idx" ON "ChatBlock"("blockerId");

-- CreateIndex
CREATE UNIQUE INDEX "ChatBlock_blockerId_blockedId_key" ON "ChatBlock"("blockerId", "blockedId");

-- CreateIndex
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- AddForeignKey
ALTER TABLE "OtpToken" ADD CONSTRAINT "OtpToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecureFile" ADD CONSTRAINT "SecureFile_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecureFile" ADD CONSTRAINT "SecureFile_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "Note"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoteShare" ADD CONSTRAINT "NoteShare_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "Note"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoteShare" ADD CONSTRAINT "NoteShare_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoteShare" ADD CONSTRAINT "NoteShare_sharedWithId_fkey" FOREIGN KEY ("sharedWithId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationMember" ADD CONSTRAINT "ConversationMember_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationMember" ADD CONSTRAINT "ConversationMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EncryptedMessage" ADD CONSTRAINT "EncryptedMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EncryptedMessage" ADD CONSTRAINT "EncryptedMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatBlock" ADD CONSTRAINT "ChatBlock_blockerId_fkey" FOREIGN KEY ("blockerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatBlock" ADD CONSTRAINT "ChatBlock_blockedId_fkey" FOREIGN KEY ("blockedId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "Note"("id") ON DELETE SET NULL ON UPDATE CASCADE;

