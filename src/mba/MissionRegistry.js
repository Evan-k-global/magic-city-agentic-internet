var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import "reflect-metadata";
import { AccountUpdate, Field, MerkleMap, MerkleMapWitness, Permissions, Poseidon, PublicKey, Signature, SmartContract, State, Struct, UInt32, UInt64, method, state } from "o1js";
import { MissionComplianceProof } from "./MissionComplianceProgram.js";
const EMPTY_MAP_ROOT = new MerkleMap().getRoot();
const ACTIVE_ESCROW_TAG = Field(1);
const SETTLED_ESCROW_TAG = Field(2);
const REFUNDED_ESCROW_TAG = Field(3);
const APPROVAL_NAMESPACE = Field(11);
const REVOCATION_NAMESPACE = Field(12);
const NULLIFIER_NAMESPACE = Field(13);
const RECEIPT_NAMESPACE = Field(14);
const ESCROW_NAMESPACE = Field(15);
export function approvalRegistryKey(capabilityCommitment) {
    return Poseidon.hash([APPROVAL_NAMESPACE, capabilityCommitment]);
}
export function revocationRegistryKey(capabilityCommitment) {
    return Poseidon.hash([REVOCATION_NAMESPACE, capabilityCommitment]);
}
export function nullifierRegistryKey(nullifier) {
    return Poseidon.hash([NULLIFIER_NAMESPACE, nullifier]);
}
export function receiptRegistryKey(receiptCommitment) {
    return Poseidon.hash([RECEIPT_NAMESPACE, receiptCommitment]);
}
export function approvalAuthorizationMessage(registryAddress, sequence, capabilityCommitment, approvalCommitment) {
    return [
        APPROVAL_NAMESPACE,
        ...registryAddress.toFields(),
        sequence.value,
        capabilityCommitment,
        approvalCommitment
    ];
}
export function revocationAuthorizationMessage(registryAddress, sequence, capabilityCommitment) {
    return [
        REVOCATION_NAMESPACE,
        ...registryAddress.toFields(),
        sequence.value,
        capabilityCommitment
    ];
}
export class MissionRegistryConfig extends Struct({
    authorityKey: PublicKey,
    protocolFeeRecipient: PublicKey
}) {
}
export class MissionEscrow extends Struct({
    missionIdHash: Field,
    payer: PublicKey,
    beneficiary: PublicKey,
    amountNanomina: UInt64,
    refundAfterSlot: UInt32,
    escrowNonce: Field
}) {
    key() {
        return Poseidon.hash([
            ESCROW_NAMESPACE,
            this.missionIdHash,
            this.escrowNonce
        ]);
    }
    leaf(status = ACTIVE_ESCROW_TAG) {
        return Poseidon.hash([
            status,
            this.missionIdHash,
            ...this.payer.toFields(),
            ...this.beneficiary.toFields(),
            this.amountNanomina.value,
            this.refundAfterSlot.value,
            this.escrowNonce
        ]);
    }
}
export class ApprovalAnchoredEvent extends Struct({
    capabilityCommitment: Field,
    approvalCommitment: Field,
    approvalRoot: Field,
    sequence: UInt64
}) {
}
export class CapabilityRevokedEvent extends Struct({
    capabilityCommitment: Field,
    revocationRoot: Field,
    sequence: UInt64
}) {
}
export class MissionFundedEvent extends Struct({
    escrowKey: Field,
    missionIdHash: Field,
    payer: PublicKey,
    beneficiary: PublicKey,
    amountNanomina: UInt64,
    refundAfterSlot: UInt32,
    escrowRoot: Field,
    sequence: UInt64
}) {
}
export class MissionSettledEvent extends Struct({
    missionIdHash: Field,
    capabilityCommitment: Field,
    receiptCommitment: Field,
    nullifier: Field,
    beneficiary: PublicKey,
    payoutNanomina: UInt64,
    protocolFeeNanomina: UInt64,
    registryRoot: Field,
    sequence: UInt64
}) {
}
export class MissionRefundedEvent extends Struct({
    escrowKey: Field,
    missionIdHash: Field,
    payer: PublicKey,
    amountNanomina: UInt64,
    escrowRoot: Field,
    sequence: UInt64
}) {
}
export class MissionRegistry extends SmartContract {
    constructor() {
        super(...arguments);
        this.authorityKey = State();
        this.protocolFeeRecipient = State();
        this.registryRoot = State();
        this.sequence = State();
        this.events = {
            approvalAnchored: ApprovalAnchoredEvent,
            capabilityRevoked: CapabilityRevokedEvent,
            missionFunded: MissionFundedEvent,
            missionSettled: MissionSettledEvent,
            missionRefunded: MissionRefundedEvent
        };
    }
    init() {
        super.init();
        this.authorityKey.set(PublicKey.empty());
        this.protocolFeeRecipient.set(PublicKey.empty());
        this.registryRoot.set(EMPTY_MAP_ROOT);
        this.sequence.set(UInt64.zero);
        this.account.permissions.set({
            ...Permissions.default(),
            editState: Permissions.proofOrSignature(),
            send: Permissions.proof(),
            setPermissions: Permissions.signature()
        });
    }
    async configure(config) {
        this.requireSignature();
        const currentAuthority = this.authorityKey.getAndRequireEquals();
        currentAuthority.isEmpty().assertTrue("registry_already_configured");
        config.authorityKey.isEmpty().assertFalse("authority_key_required");
        config.protocolFeeRecipient
            .isEmpty()
            .assertFalse("protocol_fee_recipient_required");
        this.authorityKey.set(config.authorityKey);
        this.protocolFeeRecipient.set(config.protocolFeeRecipient);
    }
    async anchorApproval(capabilityCommitment, approvalCommitment, authoritySignature, approvalWitness) {
        const authorityKey = this.authorityKey.getAndRequireEquals();
        const currentRoot = this.registryRoot.getAndRequireEquals();
        const sequence = this.sequence.getAndRequireEquals();
        authorityKey.isEmpty().assertFalse("registry_not_configured");
        approvalCommitment.assertNotEquals(Field(0));
        authoritySignature
            .verify(authorityKey, approvalAuthorizationMessage(this.address, sequence, capabilityCommitment, approvalCommitment))
            .assertTrue("invalid_authority_signature");
        const [rootBefore, witnessKey] = approvalWitness.computeRootAndKey(Field(0));
        rootBefore.assertEquals(currentRoot);
        witnessKey.assertEquals(approvalRegistryKey(capabilityCommitment));
        const [rootAfter] = approvalWitness.computeRootAndKey(approvalCommitment);
        const nextSequence = sequence.add(1);
        this.registryRoot.set(rootAfter);
        this.sequence.set(nextSequence);
        this.emitEvent("approvalAnchored", new ApprovalAnchoredEvent({
            capabilityCommitment,
            approvalCommitment,
            approvalRoot: rootAfter,
            sequence: nextSequence
        }));
    }
    async revokeCapability(capabilityCommitment, authoritySignature, revocationWitness) {
        const authorityKey = this.authorityKey.getAndRequireEquals();
        const currentRoot = this.registryRoot.getAndRequireEquals();
        const sequence = this.sequence.getAndRequireEquals();
        authoritySignature
            .verify(authorityKey, revocationAuthorizationMessage(this.address, sequence, capabilityCommitment))
            .assertTrue("invalid_revocation_signature");
        const [rootBefore, witnessKey] = revocationWitness.computeRootAndKey(Field(0));
        rootBefore.assertEquals(currentRoot);
        witnessKey.assertEquals(revocationRegistryKey(capabilityCommitment));
        const [rootAfter] = revocationWitness.computeRootAndKey(Field(1));
        const nextSequence = sequence.add(1);
        this.registryRoot.set(rootAfter);
        this.sequence.set(nextSequence);
        this.emitEvent("capabilityRevoked", new CapabilityRevokedEvent({
            capabilityCommitment,
            revocationRoot: rootAfter,
            sequence: nextSequence
        }));
    }
    async fundMission(escrow, escrowWitness) {
        const currentRoot = this.registryRoot.getAndRequireEquals();
        const sequence = this.sequence.getAndRequireEquals();
        const payer = this.sender.getAndRequireSignature();
        payer.assertEquals(escrow.payer);
        escrow.amountNanomina.assertGreaterThan(UInt64.zero);
        escrow.beneficiary.isEmpty().assertFalse("beneficiary_required");
        const escrowKey = escrow.key();
        const [rootBefore, witnessKey] = escrowWitness.computeRootAndKey(Field(0));
        rootBefore.assertEquals(currentRoot);
        witnessKey.assertEquals(escrowKey);
        const [rootAfter] = escrowWitness.computeRootAndKey(escrow.leaf());
        const nextSequence = sequence.add(1);
        const payerUpdate = AccountUpdate.createSigned(payer);
        payerUpdate.send({ to: this.address, amount: escrow.amountNanomina });
        this.registryRoot.set(rootAfter);
        this.sequence.set(nextSequence);
        this.emitEvent("missionFunded", new MissionFundedEvent({
            escrowKey,
            missionIdHash: escrow.missionIdHash,
            payer,
            beneficiary: escrow.beneficiary,
            amountNanomina: escrow.amountNanomina,
            refundAfterSlot: escrow.refundAfterSlot,
            escrowRoot: rootAfter,
            sequence: nextSequence
        }));
    }
    async settleMission(proof, escrow, approvalWitness, revocationWitness, nullifierWitness, receiptWitness, escrowWitness) {
        proof.verify();
        const input = proof.publicInput;
        const currentRegistryRoot = this.registryRoot.getAndRequireEquals();
        const sequence = this.sequence.getAndRequireEquals();
        const feeRecipient = this.protocolFeeRecipient.getAndRequireEquals();
        this.currentSlot.requireBetween(input.lastObservedSlot, input.validUntilSlot);
        escrow.refundAfterSlot
            .greaterThan(input.validUntilSlot)
            .assertTrue("refund_deadline_precedes_mission_expiry");
        escrow.missionIdHash.assertEquals(input.missionIdHash);
        escrow.beneficiary.assertEquals(input.beneficiary);
        escrow.amountNanomina.assertEquals(input.payoutNanomina.add(input.protocolFeeNanomina));
        const [approvalRoot, approvalKey] = approvalWitness.computeRootAndKey(input.approvalCommitment);
        approvalRoot.assertEquals(currentRegistryRoot);
        approvalKey.assertEquals(approvalRegistryKey(input.capabilityCommitment));
        const [revocationRoot, revocationKey] = revocationWitness.computeRootAndKey(Field(0));
        revocationRoot.assertEquals(currentRegistryRoot);
        revocationKey.assertEquals(revocationRegistryKey(input.capabilityCommitment));
        const [nullifierRoot, nullifierKey] = nullifierWitness.computeRootAndKey(Field(0));
        nullifierRoot.assertEquals(currentRegistryRoot);
        nullifierKey.assertEquals(nullifierRegistryKey(input.nullifier));
        const [nextNullifierRoot] = nullifierWitness.computeRootAndKey(Field(1));
        const [receiptRoot, receiptKey] = receiptWitness.computeRootAndKey(Field(0));
        receiptRoot.assertEquals(nextNullifierRoot);
        receiptKey.assertEquals(receiptRegistryKey(input.receiptCommitment));
        const receiptLeaf = Poseidon.hash([
            input.receiptCommitment,
            input.nullifier,
            input.paymentContextDigest,
            ...input.beneficiary.toFields(),
            input.payoutNanomina.value,
            input.protocolFeeNanomina.value
        ]);
        const [nextReceiptRoot] = receiptWitness.computeRootAndKey(receiptLeaf);
        const [escrowRoot, escrowKey] = escrowWitness.computeRootAndKey(escrow.leaf());
        escrowRoot.assertEquals(nextReceiptRoot);
        escrowKey.assertEquals(escrow.key());
        const [nextEscrowRoot] = escrowWitness.computeRootAndKey(escrow.leaf(SETTLED_ESCROW_TAG));
        this.registryRoot.set(nextEscrowRoot);
        const nextSequence = sequence.add(1);
        this.sequence.set(nextSequence);
        this.send({ to: input.beneficiary, amount: input.payoutNanomina });
        this.send({ to: feeRecipient, amount: input.protocolFeeNanomina });
        this.emitEvent("missionSettled", new MissionSettledEvent({
            missionIdHash: input.missionIdHash,
            capabilityCommitment: input.capabilityCommitment,
            receiptCommitment: input.receiptCommitment,
            nullifier: input.nullifier,
            beneficiary: input.beneficiary,
            payoutNanomina: input.payoutNanomina,
            protocolFeeNanomina: input.protocolFeeNanomina,
            registryRoot: nextEscrowRoot,
            sequence: nextSequence
        }));
    }
    async refundMission(escrow, escrowWitness) {
        const currentRoot = this.registryRoot.getAndRequireEquals();
        const sequence = this.sequence.getAndRequireEquals();
        this.currentSlot.requireBetween(escrow.refundAfterSlot, UInt32.MAXINT());
        const [rootBefore, witnessKey] = escrowWitness.computeRootAndKey(escrow.leaf());
        rootBefore.assertEquals(currentRoot);
        witnessKey.assertEquals(escrow.key());
        const [rootAfter] = escrowWitness.computeRootAndKey(escrow.leaf(REFUNDED_ESCROW_TAG));
        const nextSequence = sequence.add(1);
        this.registryRoot.set(rootAfter);
        this.sequence.set(nextSequence);
        this.send({ to: escrow.payer, amount: escrow.amountNanomina });
        this.emitEvent("missionRefunded", new MissionRefundedEvent({
            escrowKey: escrow.key(),
            missionIdHash: escrow.missionIdHash,
            payer: escrow.payer,
            amountNanomina: escrow.amountNanomina,
            escrowRoot: rootAfter,
            sequence: nextSequence
        }));
    }
}
__decorate([
    state(PublicKey),
    __metadata("design:type", Object)
], MissionRegistry.prototype, "authorityKey", void 0);
__decorate([
    state(PublicKey),
    __metadata("design:type", Object)
], MissionRegistry.prototype, "protocolFeeRecipient", void 0);
__decorate([
    state(Field),
    __metadata("design:type", Object)
], MissionRegistry.prototype, "registryRoot", void 0);
__decorate([
    state(UInt64),
    __metadata("design:type", Object)
], MissionRegistry.prototype, "sequence", void 0);
__decorate([
    method,
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [MissionRegistryConfig]),
    __metadata("design:returntype", Promise)
], MissionRegistry.prototype, "configure", null);
__decorate([
    method,
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Field,
        Field,
        Signature,
        MerkleMapWitness]),
    __metadata("design:returntype", Promise)
], MissionRegistry.prototype, "anchorApproval", null);
__decorate([
    method,
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Field,
        Signature,
        MerkleMapWitness]),
    __metadata("design:returntype", Promise)
], MissionRegistry.prototype, "revokeCapability", null);
__decorate([
    method,
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [MissionEscrow,
        MerkleMapWitness]),
    __metadata("design:returntype", Promise)
], MissionRegistry.prototype, "fundMission", null);
__decorate([
    method,
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [MissionComplianceProof,
        MissionEscrow,
        MerkleMapWitness,
        MerkleMapWitness,
        MerkleMapWitness,
        MerkleMapWitness,
        MerkleMapWitness]),
    __metadata("design:returntype", Promise)
], MissionRegistry.prototype, "settleMission", null);
__decorate([
    method,
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [MissionEscrow,
        MerkleMapWitness]),
    __metadata("design:returntype", Promise)
], MissionRegistry.prototype, "refundMission", null);
