import type { MatrixEntry } from '../support/matrix.js'

// Coverage matrix - Python and Ruby toolchains.
//
// Every fixture below is raw output in the shape the real tool prints it when
// its stdout is a pipe (no colour, no progress bars - the proxy runs the child
// with NO_COLOR/TERM=dumb, and pip/ruff/rubocop all drop their TTY chrome
// there). Each `minReduction` is measured against the shipped compress(), then
// rounded DOWN with a few points of headroom so an unrelated tweak to a
// neighbouring condenser cannot turn this file red on its own.

// ── pytest ────────────────────────────────────────────────────────────────────
// The invocation an agent runs constantly: the whole suite, some of it broken.
// The tracebacks are the bulk of the bytes and the FAILED lines in the short
// summary carry the same information in one line each.
//
// The progress block is arithmetic, not decoration, and it has to hold together
// or the measurement is taken on output pytest cannot produce: the marks sum to
// `collected 214 items` (22+24+45+47+34+42), the four F marks are the four
// FAILED lines in the short summary, 4 + 210 = 214, and the percentage column is
// FLOORED - pytest computes `len(reported) * 100 // collected` - so the
// cumulative 22/46/91/138/172/214 reads 10/21/42/64/80/100 and the last row
// really is 100%. Each line is 79 columns: pytest right-justifies " [ NN%]" into
// `fullwidth - width_of_current_line - 1`, and fullwidth off a pipe is 80.
const PYTEST_FAILURES = `============================= test session starts ==============================
platform linux -- Python 3.11.9, pytest-8.1.1, pluggy-1.5.0
rootdir: /srv/checkout
configfile: pyproject.toml
plugins: anyio-4.3.0, cov-5.0.0, mock-3.14.0
collected 214 items

tests/test_auth.py ..............F.......                                [ 10%]
tests/test_billing.py .........FF.............                           [ 21%]
tests/test_models.py .............................................       [ 42%]
tests/test_orders.py ..................................F............     [ 64%]
tests/test_reports.py ..................................                 [ 80%]
tests/test_views.py ..........................................           [100%]

=================================== FAILURES ===================================
______________________________ test_token_expiry _______________________________

    def test_token_expiry():
        token = issue_token(subject="1", ttl=0)
>       assert verify(token) is True
E       assert False is True
E        +  where False = verify('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0')

tests/test_auth.py:88: AssertionError
____________________________ test_prorate_upgrade ______________________________

    def test_prorate_upgrade():
        sub = Subscription(plan="basic", seats=3)
        sub.upgrade(plan="pro", on=date(2024, 3, 15))
>       assert sub.next_invoice().amount == Decimal("12.00")
E       AssertionError: assert Decimal('11.99') == Decimal('12.00')
E        +  where Decimal('11.99') = <Invoice id=None amount=Decimal('11.99')>.amount
E        +    where <Invoice id=None amount=Decimal('11.99')> = next_invoice()

tests/test_billing.py:141: AssertionError
_____________________________ test_refund_partial ______________________________

    def test_refund_partial():
        charge = make_charge(amount=5000)
        result = refund(charge, amount=2500)
>       assert result["refund_id"]
E       KeyError: 'refund_id'

tests/test_billing.py:203: KeyError
___________________________ test_cancel_after_ship _____________________________

    def test_cancel_after_ship():
        order = make_order(state="shipped")
>       order.cancel()

tests/test_orders.py:77:
_ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _

self = <Order id=9 state='shipped'>

    def cancel(self):
        if self.state not in CANCELLABLE:
>           raise InvalidTransition(self.state, "cancelled")
E           orders.errors.InvalidTransition: shipped -> cancelled

src/orders/models.py:118: InvalidTransition
=============================== warnings summary ===============================
tests/test_reports.py:14
  /srv/checkout/tests/test_reports.py:14: DeprecationWarning: datetime.utcnow() is deprecated
    now = datetime.utcnow()

-- Docs: https://docs.pytest.org/en/stable/warnings.html
=========================== short test summary info ============================
FAILED tests/test_auth.py::test_token_expiry - assert False is True
FAILED tests/test_billing.py::test_prorate_upgrade - AssertionError: assert Decimal('11.99') == Decimal('12.00')
FAILED tests/test_billing.py::test_refund_partial - KeyError: 'refund_id'
FAILED tests/test_orders.py::test_cancel_after_ship - orders.errors.InvalidTransition: shipped -> cancelled
================== 4 failed, 210 passed, 1 warning in 18.42s ===================
`

// ── mypy --strict ─────────────────────────────────────────────────────────────
// Turning --strict on for the first time: dozens of errors spread over a handful
// of modules, most of them the same three codes. The per-file grouping plus the
// code histogram is the answer; the repeated `path:line: error:` prefix is not.
const MYPY_STRICT = `src/api/routes.py:14: error: Function is missing a type annotation  [no-untyped-def]
src/api/routes.py:22: error: Function is missing a type annotation  [no-untyped-def]
src/api/routes.py:31: error: Function is missing a return type annotation  [no-untyped-def]
src/api/routes.py:38: error: Returning Any from function declared to return "Response"  [no-any-return]
src/api/routes.py:44: error: Missing type parameters for generic type "dict"  [type-arg]
src/api/routes.py:52: error: Argument 1 to "get_user" has incompatible type "str | None"; expected "str"  [arg-type]
src/api/routes.py:61: error: Need type annotation for "cache" (hint: "cache: dict[<type>, <type>] = ...")  [var-annotated]
src/api/routes.py:70: error: Function is missing a type annotation  [no-untyped-def]
src/api/routes.py:78: error: Returning Any from function declared to return "list[Order]"  [no-any-return]
src/api/routes.py:83: error: Call to untyped function "serialize" in typed context  [no-untyped-call]
src/api/routes.py:91: error: Incompatible return value type (got "None", expected "Response")  [return-value]
src/api/schemas.py:9: error: Missing type parameters for generic type "list"  [type-arg]
src/api/schemas.py:17: error: Function is missing a type annotation  [no-untyped-def]
src/api/schemas.py:23: error: Need type annotation for "fields"  [var-annotated]
src/api/schemas.py:31: error: Incompatible types in assignment (expression has type "str", variable has type "int")  [assignment]
src/api/schemas.py:40: error: Returning Any from function declared to return "dict[str, str]"  [no-any-return]
src/api/schemas.py:48: error: Function is missing a return type annotation  [no-untyped-def]
src/api/schemas.py:55: error: Argument "default" to "Field" has incompatible type "None"; expected "str"  [arg-type]
src/api/schemas.py:62: error: Class cannot subclass "BaseModel" (has type "Any")  [misc]
src/services/billing.py:12: error: Function is missing a type annotation  [no-untyped-def]
src/services/billing.py:19: note: See https://mypy.readthedocs.io/en/stable/_refs.html#code-no-untyped-def for more info
src/services/billing.py:27: error: Incompatible types in assignment (expression has type "Decimal", variable has type "float")  [assignment]
src/services/billing.py:34: error: Call to untyped function "prorate" in typed context  [no-untyped-call]
src/services/billing.py:41: error: Argument 2 to "charge" has incompatible type "float"; expected "Decimal"  [arg-type]
src/services/billing.py:58: error: Returning Any from function declared to return "Invoice"  [no-any-return]
src/services/billing.py:66: error: Function is missing a return type annotation  [no-untyped-def]
src/services/billing.py:73: error: Item "None" of "Customer | None" has no attribute "id"  [union-attr]
src/services/report.py:8: error: Function is missing a type annotation  [no-untyped-def]
src/services/report.py:15: error: Need type annotation for "totals"  [var-annotated]
src/services/report.py:22: error: Missing type parameters for generic type "dict"  [type-arg]
src/services/report.py:29: note: See https://mypy.readthedocs.io/en/stable/_refs.html#code-type-arg for more info
src/services/report.py:36: error: Unsupported operand types for + ("int" and "None")  [operator]
src/services/report.py:44: error: Returning Any from function declared to return "Rollup"  [no-any-return]
src/services/report.py:51: error: Function is missing a return type annotation  [no-untyped-def]
src/db/session.py:6: error: Function is missing a type annotation  [no-untyped-def]
src/db/session.py:13: error: Call to untyped function "create_engine" in typed context  [no-untyped-call]
src/db/session.py:20: error: Missing type parameters for generic type "Session"  [type-arg]
src/db/session.py:28: error: Item "None" of "Engine | None" has no attribute "dispose"  [union-attr]
Found 36 errors in 5 files (checked 128 source files)
`

// ── ruff check ────────────────────────────────────────────────────────────────
// Captured from real ruff 0.15.10 - `ruff check .`, no flags, on a five-module
// package whose config sets `select = ["E", "F"]` (the common superset; ruff's
// own default rule set is E4/E7/E9 + F, which leaves E501 off). ONE edit was
// made to what ruff printed: the Windows path separators in the ` --> ` lines
// were rewritten to `/`, so the fixture reads as the Linux run the rest of this
// file describes.
//
// The default format is `full`, and since 0.14 that means: the rule code leads
// its own line, the location follows on a ` --> path:line:col` line, ~6 lines of
// carets and source context follow that, and the hint is a FLUSH-LEFT `help:`
// trailer. It is not the pre-0.14 `path:line:col: CODE message` head with an
// indented `= help:` beneath it - a fixture in that older shape would measure
// the condenser against output current ruff cannot produce.
const RUFF_CHECK = `F401 [*] \`os\` imported but unused
 --> src/api/routes.py:1:8
  |
1 | import os
  |        ^^
2 | import sys
3 | import json
  |
help: Remove unused import: \`os\`

F401 [*] \`sys\` imported but unused
 --> src/api/routes.py:2:8
  |
1 | import os
2 | import sys
  |        ^^^
3 | import json
4 | from typing import Any
  |
help: Remove unused import: \`sys\`

E501 Line too long (112 > 88)
  --> src/api/routes.py:44:89
   |
42 | @router.get("/orders")
43 | def list_orders(request):
44 |     return JSONResponse({"orders": [serialize(o) for o in Order.objects.filter(status="open").order_by("-id")]})
   |                                                                                         ^^^^^^^^^^^^^^^^^^^^^^^^
   |

E722 Do not use bare \`except\`
  --> src/api/routes.py:70:5
   |
68 |     try:
69 |         payload = json.loads(body)
70 |     except:
   |     ^^^^^^
71 |         return error(400)
72 |     return JSONResponse({"received": payload.get("id")})
   |

F811 [*] Redefinition of unused \`Field\` from line 1
 --> src/api/schemas.py:1:22
  |
1 | from pydantic import Field
  |                      ----- previous definition of \`Field\` here
2 | from pydantic import BaseModel
3 | from pydantic import Field
  |                      ^^^^^ \`Field\` redefined here
4 |
5 | from decimal import Decimal
  |
help: Remove definition: \`Field\`

E501 Line too long (95 > 88)
  --> src/api/schemas.py:31:89
   |
30 | class OrderIn(BaseModel):
31 |     items: list = Field(default_factory=list, description="line items that make up this order")
   |                                                                                         ^^^^^^^
32 |     coupon: str | None = None
33 |     note: str = ""
   |

E501 Line too long (90 > 88)
  --> src/db/session.py:20:89
   |
19 | def make_session():
20 |     return sessionmaker(bind=create_engine(DATABASE_URL, pool_pre_ping=True), future=True)
   |                                                                                         ^^
   |

F401 [*] \`decimal.ROUND_UP\` imported but unused
  --> src/services/billing.py:9:30
   |
 7 | from datetime import date
 8 |
 9 | from decimal import Decimal, ROUND_UP
   |                              ^^^^^^^^
10 |
11 | from ..models import Invoice
   |
help: Remove unused import: \`decimal.ROUND_UP\`

E741 Ambiguous variable name: \`l\`
  --> src/services/billing.py:27:9
   |
25 |     def prorate(self, days):
26 |         """Split the amount across the billing period."""
27 |         l = self.amount / 30
   |         ^
28 |         return l * days
   |

E501 Line too long (102 > 88)
  --> src/services/billing.py:58:89
   |
57 |     def invoice(self):
58 |         return Invoice(customer=self.customer, amount=self.amount, issued_on=date.today(), paid=False)
   |                                                                                         ^^^^^^^^^^^^^^
   |

F841 Local variable \`totals\` is assigned to but never used
  --> src/services/report.py:15:5
   |
13 | def rollup(rows):
14 |     """Sum the amount column."""
15 |     totals = {}
   |     ^^^^^^
16 |     return [r.amount for r in rows]
   |
help: Remove assignment to unused variable \`totals\`

E711 Comparison to \`None\` should be \`cond is None\`
  --> src/services/report.py:36:23
   |
34 |     kept = []
35 |     for r in rows:
36 |         if r.total == None:
   |                       ^^^^
37 |             continue
38 |         kept.append(r)
   |
help: Replace with \`cond is None\`

Found 12 errors.
[*] 4 fixable with the \`--fix\` option (2 hidden fixes can be enabled with the \`--unsafe-fixes\` option).
`

// ── pip install ───────────────────────────────────────────────────────────────
// A cold install of a requirements file. Piped (not a TTY) pip prints no
// progress bars, but two lines of resolver chatter per package - and the only
// two lines that answer "what do I now have installed" are at the end.
const PIP_INSTALL = `Looking in indexes: https://pypi.org/simple
Collecting fastapi==0.110.0 (from -r requirements.txt (line 1))
  Downloading fastapi-0.110.0-py3-none-any.whl.metadata (25 kB)
Collecting uvicorn==0.29.0 (from -r requirements.txt (line 2))
  Downloading uvicorn-0.29.0-py3-none-any.whl.metadata (6.3 kB)
Collecting sqlalchemy==2.0.29 (from -r requirements.txt (line 3))
  Downloading SQLAlchemy-2.0.29-cp311-cp311-manylinux_2_17_x86_64.whl.metadata (9.6 kB)
Collecting pydantic==2.6.4 (from -r requirements.txt (line 4))
  Downloading pydantic-2.6.4-py3-none-any.whl.metadata (84 kB)
Collecting httpx==0.27.0 (from -r requirements.txt (line 5))
  Downloading httpx-0.27.0-py3-none-any.whl.metadata (7.2 kB)
Collecting starlette<0.37.0,>=0.36.3 (from fastapi==0.110.0->-r requirements.txt (line 1))
  Downloading starlette-0.36.3-py3-none-any.whl.metadata (5.9 kB)
Collecting typing-extensions>=4.8.0 (from fastapi==0.110.0->-r requirements.txt (line 1))
  Using cached typing_extensions-4.10.0-py3-none-any.whl.metadata (3.0 kB)
Collecting click>=7.0 (from uvicorn==0.29.0->-r requirements.txt (line 2))
  Using cached click-8.1.7-py3-none-any.whl.metadata (3.0 kB)
Collecting h11>=0.8 (from uvicorn==0.29.0->-r requirements.txt (line 2))
  Using cached h11-0.14.0-py3-none-any.whl.metadata (8.2 kB)
Collecting greenlet!=0.4.17 (from sqlalchemy==2.0.29->-r requirements.txt (line 3))
  Downloading greenlet-3.0.3-cp311-cp311-manylinux_2_24_x86_64.whl.metadata (3.8 kB)
Collecting annotated-types>=0.4.0 (from pydantic==2.6.4->-r requirements.txt (line 4))
  Using cached annotated_types-0.6.0-py3-none-any.whl.metadata (12 kB)
Collecting pydantic-core==2.16.3 (from pydantic==2.6.4->-r requirements.txt (line 4))
  Downloading pydantic_core-2.16.3-cp311-cp311-manylinux_2_17_x86_64.whl.metadata (6.5 kB)
Collecting anyio (from httpx==0.27.0->-r requirements.txt (line 5))
  Downloading anyio-4.3.0-py3-none-any.whl.metadata (4.6 kB)
Collecting certifi (from httpx==0.27.0->-r requirements.txt (line 5))
  Using cached certifi-2024.2.2-py3-none-any.whl.metadata (2.2 kB)
Collecting httpcore==1.* (from httpx==0.27.0->-r requirements.txt (line 5))
  Downloading httpcore-1.0.5-py3-none-any.whl.metadata (20 kB)
Collecting idna (from httpx==0.27.0->-r requirements.txt (line 5))
  Using cached idna-3.6-py3-none-any.whl.metadata (9.9 kB)
Collecting sniffio (from httpx==0.27.0->-r requirements.txt (line 5))
  Using cached sniffio-1.3.1-py3-none-any.whl.metadata (3.9 kB)
Downloading fastapi-0.110.0-py3-none-any.whl (92 kB)
Downloading uvicorn-0.29.0-py3-none-any.whl (60 kB)
Downloading SQLAlchemy-2.0.29-cp311-cp311-manylinux_2_17_x86_64.whl (3.1 MB)
Downloading pydantic-2.6.4-py3-none-any.whl (394 kB)
Downloading pydantic_core-2.16.3-cp311-cp311-manylinux_2_17_x86_64.whl (2.1 MB)
Downloading httpx-0.27.0-py3-none-any.whl (75 kB)
Downloading httpcore-1.0.5-py3-none-any.whl (77 kB)
Downloading starlette-0.36.3-py3-none-any.whl (71 kB)
Downloading greenlet-3.0.3-cp311-cp311-manylinux_2_24_x86_64.whl (616 kB)
Downloading anyio-4.3.0-py3-none-any.whl (85 kB)
Installing collected packages: typing-extensions, sniffio, idna, h11, greenlet, click, certifi, annotated-types, sqlalchemy, pydantic-core, httpcore, anyio, uvicorn, starlette, pydantic, httpx, fastapi
Successfully installed annotated-types-0.6.0 anyio-4.3.0 certifi-2024.2.2 click-8.1.7 fastapi-0.110.0 greenlet-3.0.3 h11-0.14.0 httpcore-1.0.5 httpx-0.27.0 idna-3.6 pydantic-2.6.4 pydantic-core-2.16.3 sniffio-1.3.1 sqlalchemy-2.0.29 starlette-0.36.3 typing-extensions-4.10.0 uvicorn-0.29.0
`

// ── rspec ─────────────────────────────────────────────────────────────────────
// Documentation formatter (what a Rails project's .rspec usually pins), one
// failing spec file out of several. The nested doc tree and the expectation
// diffs are the bytes; the failure titles are the information.
//
// The doc formatter prints exactly ONE line per example, so the tree has to
// carry as many example lines as the tally claims: 16 here (3 + 3 + 2 + 3 + 3 +
// 2), of which 3 are marked "(FAILED - n)" and reappear in the Failures block
// and in the "Failed examples:" rerun list. condenseRspec copies the tally
// verbatim, so a tree that did not add up would have the matrix certify a
// reduction against output rspec cannot emit.
const RSPEC_FAILURES = `Randomized with seed 20460

Order
  #total
    sums the line items
    applies a percentage discount
    rounds half to even (FAILED - 1)
  #cancel
    moves a pending order to cancelled
    refuses to cancel a shipped order (FAILED - 2)
    releases the reserved stock

Invoice
  #prorate
    charges a partial month
    handles a mid-cycle upgrade (FAILED - 3)
  #issue
    assigns a sequential number
    emails the customer
    marks the invoice as issued

User
  #full_name
    concatenates first and last
    handles a missing last name
    strips surrounding whitespace
  #admin?
    is true for staff
    is false for everyone else

Failures:

  1) Order#total rounds half to even
     Failure/Error: expect(order.total).to eq(BigDecimal("11.99"))

       expected: 0.1199e2
            got: 0.12e2

       (compared using ==)

     # ./spec/models/order_spec.rb:48:in 'block (3 levels) in <top (required)>'

  2) Order#cancel refuses to cancel a shipped order
     Failure/Error: expect { order.cancel }.to raise_error(Order::InvalidTransition)

       expected Order::InvalidTransition, got #<NoMethodError: undefined method 'cancel!' for an instance of Order> with backtrace:
         # ./app/models/order.rb:88:in 'Order#cancel'
         # ./spec/models/order_spec.rb:72:in 'block (4 levels) in <top (required)>'

     # ./spec/models/order_spec.rb:72:in 'block (3 levels) in <top (required)>'

  3) Invoice#prorate handles a mid-cycle upgrade
     Failure/Error: expect(invoice.amount_cents).to eq(1199)

       expected: 1199
            got: 1200

       (compared using ==)

     # ./spec/models/invoice_spec.rb:31:in 'block (3 levels) in <top (required)>'

Finished in 1.86 seconds (files took 2.41 seconds to load)
16 examples, 3 failures

Failed examples:

rspec ./spec/models/order_spec.rb:48 # Order#total rounds half to even
rspec ./spec/models/order_spec.rb:72 # Order#cancel refuses to cancel a shipped order
rspec ./spec/models/invoice_spec.rb:31 # Invoice#prorate handles a mid-cycle upgrade
`

// ── rake test ─────────────────────────────────────────────────────────────────
// Minitest behind rake. The condenser rewrites the tally line and drops rake's
// own chatter and the blank lines, but deliberately KEEPS every failure body -
// which is most of the text, so the honest number here is small.
const RAKE_TEST = `(in /srv/checkout)
Run options: --seed 47120

# Running:

.......F.......E......S.........F.........

Finished in 3.482119s, 12.0637 runs/s, 27.5680 assertions/s.

  1) Failure:
BillingTest#test_prorated_invoice_amount [test/models/billing_test.rb:64]:
Expected: 1199
  Actual: 1200

  2) Error:
OrderTest#test_cancel_after_ship:
Order::InvalidTransition: cannot move from shipped to cancelled
    app/models/order.rb:88:in 'transition_to'
    test/models/order_test.rb:41:in 'block in <class:OrderTest>'

  3) Failure:
ReportTest#test_monthly_rollup_totals [test/models/report_test.rb:120]:
Expected: {"jan" => 4, "feb" => 7}
  Actual: {"jan" => 4, "feb" => 6}

42 runs, 96 assertions, 2 failures, 1 errors, 1 skips

rake aborted!
Command failed with status (1)

Tasks: TOP => test
(See full trace by running task with --trace)
`

// ── rubocop ───────────────────────────────────────────────────────────────────
// Default (progress) formatter on a Rails app: each offense is a header line
// plus the offending source line plus a caret ruler. The two extra lines per
// offense are pure noise once the message is kept.
//
// The progress line is one character per INSPECTED file - 24 of them, matching
// "Inspecting 24 files" - and a file's character is "." when it is clean,
// otherwise the code of its HIGHEST-severity offense. Four files offend here, so
// the line carries exactly four marks: orders_controller (C,C,C,W,C -> W),
// order.rb (C,C,W,E -> E), billing.rb (C,W,C,C -> W), order_spec.rb (C,C,W -> W).
const RUBOCOP_OFFENSES = `Inspecting 24 files
.W...E.......W.....W....

Offenses:

app/controllers/orders_controller.rb:1:1: C: Style/FrozenStringLiteralComment: Missing frozen string literal comment.
class OrdersController < ApplicationController
^
app/controllers/orders_controller.rb:14:5: C: Metrics/AbcSize: Assignment Branch Condition size for create is too high. [<7, 24, 6> 26.1/17]
    def create
    ^^^^^^^^^^
app/controllers/orders_controller.rb:22:81: C: Layout/LineLength: Line is too long. [104/80]
      @orders = Order.where(status: params[:status]).includes(:line_items).order(created_at: :desc)
                                                                                ^^^^^^^^^^^^^^^^^^
app/controllers/orders_controller.rb:31:7: W: Lint/UselessAssignment: Useless assignment to variable - total.
      total = @orders.sum(&:amount)
      ^^^^^
app/controllers/orders_controller.rb:44:1: C: Style/StringLiterals: Prefer single-quoted strings when you don't need string interpolation or special symbols.
      redirect_to "/orders", notice: "Order created"
                  ^^^^^^^^^
app/models/order.rb:1:1: C: Style/Documentation: Missing top-level documentation comment for class Order.
class Order < ApplicationRecord
^^^^^
app/models/order.rb:19:3: C: Metrics/MethodLength: Method has too many lines. [18/10]
  def transition_to(state)
  ^^^^^^^^^^^^^^^^^^^^^^^^
app/models/order.rb:52:11: W: Lint/ShadowingOuterLocalVariable: Shadowing outer local variable - row.
    rows.map { |row| row.amount }
              ^^^^^
app/models/order.rb:88:5: E: Lint/Syntax: unexpected token kEND (Using Ruby 3.2 parser; configure using TargetRubyVersion parameter, under AllCops).
    end
    ^^^
app/services/billing.rb:5:3: C: Style/FrozenStringLiteralComment: Missing frozen string literal comment.
  class Billing
  ^
app/services/billing.rb:27:9: W: Lint/UselessAssignment: Useless assignment to variable - l.
        l = amount / 30
        ^
app/services/billing.rb:34:81: C: Layout/LineLength: Line is too long. [97/80]
        Invoice.create!(customer: customer, amount: amount, issued_on: Date.today, paid: false)
                                                                                  ^^^^^^^^^^^
app/services/billing.rb:41:5: C: Style/GuardClause: Use a guard clause instead of wrapping the code inside a conditional expression.
    if customer.present?
    ^^
spec/models/order_spec.rb:1:1: C: Style/FrozenStringLiteralComment: Missing frozen string literal comment.
require 'rails_helper'
^
spec/models/order_spec.rb:48:81: C: Layout/LineLength: Line is too long. [91/80]
      expect(order.total).to eq(BigDecimal("11.99")), "rounding half to even is required here"
                                                     ^^^^^^^^^^^
spec/models/order_spec.rb:72:5: W: Lint/AmbiguousBlockAssociation: Parenthesize the param to make sure that the block will be associated with the method call.
    expect { order.cancel }.to raise_error Order::InvalidTransition
    ^^^^^^^^^^^^^^^^^^^^^^

24 files inspected, 16 offenses detected
`

// Measured against the shipped compress() (harness linkage), floors set below:
//   pytest   3387 ->  230 = 93%      mypy     3905 -> 1976 = 49%
//   ruff     3584 ->   71 = 98%      pip      3550 ->  491 = 86%
//   rspec    2018 ->  177 = 91%      rake      829 ->  782 =  6%
//   rubocop  3044 -> 1348 = 56%
export const PYTHON_MATRIX: MatrixEntry[] = [
  {
    cmd: 'pytest',
    args: [],
    what: 'full suite, 4 failures out of 214 - tracebacks collapsed to the failing node ids',
    input: PYTEST_FAILURES,
    minReduction: 85, // measured 93
  },
  {
    cmd: 'mypy',
    args: ['--strict', 'src'],
    what: '36 strict-mode errors across 5 modules - grouped per file with a code histogram',
    input: MYPY_STRICT,
    minReduction: 40, // measured 49
  },
  {
    cmd: 'ruff',
    args: ['check', '.'],
    what: 'default full output format, 12 violations - collapsed to one counts-and-rules line',
    input: RUFF_CHECK,
    minReduction: 90, // measured 98
  },
  {
    cmd: 'pip',
    args: ['install', '-r', 'requirements.txt'],
    what: 'cold install of 5 pinned requirements - resolver chatter dropped, result kept',
    input: PIP_INSTALL,
    minReduction: 78, // measured 86
  },
  {
    cmd: 'rspec',
    args: ['spec'],
    what: 'documentation formatter, 3 failures in 16 examples - diffs and backtraces dropped',
    input: RSPEC_FAILURES,
    minReduction: 82, // measured 91
  },
  {
    // The honest number for rake is small, and that is the design: condenseRake
    // rewrites the minitest tally and deletes rake's own chatter, but every
    // failure body survives verbatim - which is most of the bytes. The wrapper
    // earns its ~40 ms here by folding the tally and the blank lines, not by
    // summarising the failures the agent is reading the output for.
    cmd: 'rake',
    args: ['test'],
    what: 'minitest behind rake - tally rewritten, rake chatter dropped, failure bodies kept',
    input: RAKE_TEST,
    minReduction: 2, // measured 6
  },
  {
    cmd: 'rubocop',
    args: [],
    what: '16 offenses over 4 files - source line and caret ruler dropped, messages grouped',
    input: RUBOCOP_OFFENSES,
    minReduction: 48, // measured 56
  },
]
