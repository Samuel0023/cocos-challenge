#!/bin/sh
# Creates the order-events topic, queue and subscription in AWS Emulator, then exits.
# Runs in the emulator's network namespace: the certificate only covers 127.0.0.1 and localhost.
set -eu

dir="/emulator/9297"
for _ in $(seq 60); do
  if [ -f "$dir/ca.pem" ] && curl -sf --cacert "$dir/ca.pem" https://127.0.0.1:9297/__admin/health >/dev/null; then
    break
  fi
  sleep 1
done

export AWS_ENDPOINT_URL=https://127.0.0.1:9297
export AWS_SHARED_CREDENTIALS_FILE="$dir/emulator_credentials"
export AWS_CA_BUNDLE="$dir/ca.pem"
export AWS_REGION=us-east-1 AWS_DEFAULT_REGION=us-east-1
export AWS_EC2_METADATA_DISABLED=true AWS_DISABLE_HOST_PREFIX_INJECTION=true
unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN AWS_PROFILE

topic_arn=$(aws sns create-topic --name order-events --query TopicArn --output text)
# Messages that fail 5 times (e.g. not an order event) move to the dead-letter queue.
dlq_url=$(aws sqs create-queue --queue-name order-events-dlq --query QueueUrl --output text)
dlq_arn=$(aws sqs get-queue-attributes --queue-url "$dlq_url" \
  --attribute-names QueueArn --query Attributes.QueueArn --output text)
# The script must be safe to run again: CreateQueue fails on an existing queue whose attributes
# differ, so reuse the queue when it exists and set the attributes separately.
queue_url=$(aws sqs get-queue-url --queue-name order-events-queue --query QueueUrl --output text 2>/dev/null) ||
  queue_url=$(aws sqs create-queue --queue-name order-events-queue --query QueueUrl --output text)
queue_arn=$(aws sqs get-queue-attributes --queue-url "$queue_url" \
  --attribute-names QueueArn --query Attributes.QueueArn --output text)

# Same policy AWS needs to let the topic write to the queue.
policy=$(printf '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"sns.amazonaws.com"},"Action":"sqs:SendMessage","Resource":"%s","Condition":{"ArnEquals":{"aws:SourceArn":"%s"}}}]}' "$queue_arn" "$topic_arn")
redrive=$(printf '{"deadLetterTargetArn":"%s","maxReceiveCount":"5"}' "$dlq_arn")
quote() { printf '%s' "$1" | sed 's/"/\\"/g; s/^/"/; s/$/"/'; }
attributes=$(printf '{"VisibilityTimeout":"30","Policy":%s,"RedrivePolicy":%s}' "$(quote "$policy")" "$(quote "$redrive")")
aws sqs set-queue-attributes --queue-url "$queue_url" --attributes "$attributes"

# Idempotent: subscribing the same endpoint again returns the existing subscription.
aws sns subscribe --topic-arn "$topic_arn" --protocol sqs --notification-endpoint "$queue_arn" \
  --query SubscriptionArn --output text >/dev/null

echo "ORDER_EVENTS_TOPIC_ARN=$topic_arn"
echo "ORDER_EVENTS_QUEUE_URL=$queue_url"
