var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
  var c = arguments.length;
  var r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc;
  var d;
  if (typeof Reflect === 'object' && typeof Reflect.decorate === 'function') {
    r = Reflect.decorate(decorators, target, key, desc);
  } else {
    for (var i = decorators.length - 1; i >= 0; i--) {
      if ((d = decorators[i])) {
        r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
      }
    }
  }
  return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (key, value) {
  if (typeof Reflect === 'object' && typeof Reflect.metadata === 'function') return Reflect.metadata(key, value);
};

import { Field, Permissions, SmartContract, State, UInt64, method, state } from 'o1js';

const signaturePermission = Permissions.signature;

export class MagicCityMissionAuthRegistry extends SmartContract {
  constructor(...args) {
    super(...args);
    this.latestStatementHash = State();
    this.latestPayloadDigest = State();
    this.anchoredCount = State();
    this.events = {
      missionAuthAnchored: Field
    };
  }

  init() {
    super.init();
    this.latestStatementHash.set(Field.fromJSON('0'));
    this.latestPayloadDigest.set(Field.fromJSON('0'));
    this.anchoredCount.set(UInt64.from(0));
    this.account.permissions.set({
      ...Permissions.default(),
      editState: signaturePermission ? signaturePermission() : Permissions.proof()
    });
  }

  async anchorMissionAuth(statementHash, payloadDigest) {
    this.self.requireSignature();
    this.latestStatementHash.set(statementHash);
    this.latestPayloadDigest.set(payloadDigest);
    const currentCount = this.anchoredCount.getAndRequireEquals();
    this.anchoredCount.set(currentCount.add(UInt64.from(1)));
    this.emitEvent('missionAuthAnchored', statementHash);
  }
}

__decorate([
  state(Field),
  __metadata('design:type', Object)
], MagicCityMissionAuthRegistry.prototype, 'latestStatementHash', void 0);
__decorate([
  state(Field),
  __metadata('design:type', Object)
], MagicCityMissionAuthRegistry.prototype, 'latestPayloadDigest', void 0);
__decorate([
  state(UInt64),
  __metadata('design:type', Object)
], MagicCityMissionAuthRegistry.prototype, 'anchoredCount', void 0);
__decorate([
  method,
  __metadata('design:type', Function),
  __metadata('design:paramtypes', [Field, Field]),
  __metadata('design:returntype', Promise)
], MagicCityMissionAuthRegistry.prototype, 'anchorMissionAuth', null);
