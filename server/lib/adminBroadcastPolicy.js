function broadcastConfirmationError(body={}){
  return String(body.confirmation||"")==="SEND_BROADCAST"?null:"broadcast_confirmation_required";
}
module.exports={broadcastConfirmationError};
