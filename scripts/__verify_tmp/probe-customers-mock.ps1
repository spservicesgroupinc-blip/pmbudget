$base = 'http://localhost:3000/api/gapps-mock'
function Post($o) {
  $body = $o | ConvertTo-Json -Compress -Depth 10
  (Invoke-WebRequest -UseBasicParsing -Uri $base -Method POST -ContentType 'text/plain' -Body $body).Content
}
$login = Post @{ appKey='x'; action='login'; email='demo@hayssons.com'; password='restore2026' }
"LOGIN: $login"
$tok = ($login | ConvertFrom-Json).data.token
$save = Post @{ appKey='x'; action='saveCustomerProfile'; token=$tok; profile=@{client_name='Jones Family'; claim_number='42-C1'; carrier='Liberty Mutual'; property_address='123 Main St'; total_rcv=48720.50}; estimate_json='{"project_meta":{"client_name":"Jones Family","claim_number":"42-C1"}}' }
"SAVE: $save"
$cid = ($save | ConvertFrom-Json).data.customer_id
"CID: $cid"
$list = Post @{ appKey='x'; action='listCustomerProfiles'; token=$tok }
"LIST: $list"
$get = Post @{ appKey='x'; action='getCustomerProfile'; token=$tok; customer_id=$cid }
"GET: $get"
$up = Post @{ appKey='x'; action='uploadCustomerPdf'; token=$tok; customer_id=$cid; filename='Jones_Family_Claim_42-C1_WorkOrders.pdf'; pdfBase64='JVBERi0xLjQK' }
"UPLOAD: $up"
$del = Post @{ appKey='x'; action='deleteCustomerProfile'; token=$tok; customer_id=$cid }
"DELETE: $del"
$list2 = Post @{ appKey='x'; action='listCustomerProfiles'; token=$tok }
"LIST AFTER DELETE: $list2"
