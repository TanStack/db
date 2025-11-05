# Redux vs Tanstack db render speed test

## Instructions
 - `npm i`
 - `npm start`
 - Go to `http://localhost:5173/`
 - You can switch 'versions' at the top
 - Then I just use the chrome performance tab and look at the interaction speeds.
 - We were using node 20.12.2 but I imagine anything recent will work fine.

## Files of interest
 - `Application.tsx` - Provider wrappers
 - `MainShell.tsx` - all the components
   - The `Rows` component on line 29 varies the tanstack vs redux code
   - Those varied components are right below it
 - `mockData.ts` - quick hacky way to get fake data into redux and collection

 ## Performance stats
  - My machine is an Intel(R) Core(TM) i7-14700 2.10 GHz. Our users tend to have slower machines like an i7-8700 3.20 GHz
  - If I tab back and forth ten times I see an average of:
    - Dev build results
      - **91 ms** for tanstack version
      - **48 ms** for the redux version dev version
      - Set cpu throttle to **4x slower**, the averages are **364 ms** tanstack vs **155 ms** redux
    - Prod build results
      - **54.4 ms** for tanstack version
      - **34.4 ms** for the redux version dev version
      - Set cpu throttle to **4x slower**, the averages are **194.4 ms** tanstack vs **63 ms** redux

## Prod build tab speed comparison (ms)

|          | Tanstack | Redux    | Tanstack 4x | Redux 4x |
|:--------:|:--------:|:--------:|:-----------:|:--------:|
| Tab 1    | 64       | 48       | 248         | 80       |
| Tab 2    | 56       | 24       | 208         | 72       |
| Tab 3    | 48       | 32       | 192         | 72       |
| Tab 4    | 48       | 40       | 184         | 64       |
| Tab 5    | 48       | 16       | 200         | 64       |
| Tab 6    | 48       | 64       | 176         | 64       |
| Tab 7    | 40       | 24       | 184         | 64       |
| Tab 8    | 56       | 24       | 184         | 72       |
| Tab 9    | 48       | 16       | 160         | 40       |
| Tab 10   | 40       | 56       | 168         | 40       |
| **Avg**  | **49.6** | **34.4** | **190.4**   | **63.2** |
    
# Summary
 - It seems to be about **40% slower** on a fast machine but slower cpu it is up to **3x slower**. Our users HAVE to have a fast screen.
 - We really want to use something like this for our code as all the redux boilerplate (though it's better with Redux toolkit now) and work you have to do to pre-index the store, etc to make things efficient is a a lot of extra work and code.
 - Even this demo doesn't quite show how much data our users have on the screen at one time, so any differentiation in speed gets multiplied significantly
 - Tanstack db would be a gamechanger for us in terms of amount of code and crazy processing we have to do before data gets into our redux store to anticipate various different views for our users. With tanstack it'd be one if statement in a live query compared to hundreds of lines of code currently. I wish I was kidding. :-)
